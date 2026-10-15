import { randomInt } from 'node:crypto'

import type { ChannelId } from '@/core/channels'
import type {
  PairingApproveArgs,
  PairingApproveResult,
  PairingDenyArgs,
  PairingRequestResult,
  PairingStore,
  PendingPairing,
} from '@/core/types/session'
import type { Dialect, Storage, Transaction } from '@/core/types/storage'
import { StorageError } from '@/core/errors'
import { PAIRING_MAX_PENDING } from '@/persistence/pairing-policy'

// Unambiguous alphabet: no O/0, I/1, L. Codes are read aloud and retyped.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LEN = 6
// A code an operator never got around to approving must not stay redeemable forever.
const CODE_TTL_MS = 15 * 60_000
// Bounded retry: if capacity exists but generated codes collide, re-mint a few times.
const PAIRING_CODE_MINT_ATTEMPTS = 5

interface PendingRow {
  readonly code: string
  readonly chat_id: string
  readonly created_at: number
}

interface SlotRow {
  readonly pending_slot: number
}

interface ReclaimableSlotRow extends SlotRow {
  readonly code: string
}

interface Sql {
  readonly isPaired: string
  readonly findPendingByChat: string
  readonly findPendingByCode: string
  readonly findPendingByChannelCode: string
  readonly insertPending: string
  readonly approve: string
  readonly approveForChannel: string
  readonly deny: string
  readonly denyForChannel: string
  readonly listPending: string
  readonly revoke: string
  readonly deleteExpired: string
  readonly listUsedSlots: string
  readonly newestPendingSlot: string
}

export function createPairingStore(db: Storage, dialect: Dialect): PairingStore {
  const sql = buildSql(dialect)

  return {
    async isPaired(channel: ChannelId, chatId: string): Promise<boolean> {
      const rows = await db.query<{ readonly one: number }>(sql.isPaired, [channel, chatId])

      return rows.length > 0
    },

    // Every message from an unpaired chat lands here, so the repeat case answers from one read: a
    // write transaction per inbound message would let unadmitted senders saturate the write queue.
    async requestCode(args: {
      readonly channel: ChannelId
      readonly chatId: string
      readonly now: number
    }): Promise<PairingRequestResult> {
      const { channel, chatId, now } = args
      const [live] = await db.query<PendingRow>(sql.findPendingByChat, [
        channel,
        chatId,
        now - CODE_TTL_MS,
      ])

      if (live) {
        return { status: 'pending' }
      }

      return db.transaction((tx) => requestCodeTx({ tx, sql, channel, chatId, now }))
    },

    approve: (args) => approvePairing(db, sql, args),
    deny: (args) => denyPairing(db, sql, args),

    async listPending(channel: ChannelId, now: number): Promise<readonly PendingPairing[]> {
      const rows = await db.query<PendingRow>(sql.listPending, [channel, now - CODE_TTL_MS])

      return rows.map((row) => ({
        code: row.code,
        chatId: row.chat_id,
        expiresAt: row.created_at + CODE_TTL_MS,
      }))
    },

    // Drops the approved binding and any pending code, so a revoked chat must pair again.
    async revoke(channel: ChannelId, chatId: string): Promise<boolean> {
      const { changes } = await db.execute(sql.revoke, [channel, chatId])

      return changes > 0
    },
  }
}

async function approvePairing(
  db: Storage,
  sql: Sql,
  args: PairingApproveArgs
): Promise<PairingApproveResult> {
  const { code, now, channel } = args
  const lookup =
    channel === undefined
      ? { statement: sql.findPendingByCode, params: [code] }
      : { statement: sql.findPendingByChannelCode, params: [channel, code] }
  const [row] = await db.query<PendingRow>(lookup.statement, lookup.params)

  if (!row) {
    return { ok: false, reason: 'not_found' }
  }

  if (row.created_at <= now - CODE_TTL_MS) {
    return { ok: false, reason: 'expired' }
  }

  // A concurrent deny or revoke lands between the read and the update; only the update decides.
  const update =
    channel === undefined
      ? { statement: sql.approve, params: [now, code] }
      : { statement: sql.approveForChannel, params: [now, channel, code] }
  const { changes } = await db.execute(update.statement, update.params)

  if (changes === 0) {
    return { ok: false, reason: 'not_found' }
  }

  return { ok: true, chatId: row.chat_id }
}

async function denyPairing(db: Storage, sql: Sql, args: PairingDenyArgs): Promise<boolean> {
  const operation =
    args.channel === undefined
      ? { statement: sql.deny, params: [args.code] }
      : { statement: sql.denyForChannel, params: [args.channel, args.code] }
  const { changes } = await db.execute(operation.statement, operation.params)

  return changes > 0
}

interface RequestCodeTxArgs {
  readonly tx: Transaction
  readonly sql: Sql
  readonly channel: ChannelId
  readonly chatId: string
  readonly now: number
}

async function requestCodeTx(args: RequestCodeTxArgs): Promise<PairingRequestResult> {
  const { tx, sql, channel, chatId, now } = args
  const ttlCutoff = now - CODE_TTL_MS

  await tx.execute(sql.deleteExpired, [channel, ttlCutoff])

  const existing = await findPendingByChat({ tx, sql, channel, chatId, ttlCutoff })

  if (existing) {
    return { status: 'pending' }
  }

  let slot = await claimSlot({ tx, sql, channel, ttlCutoff })

  for (let attempt = 0; attempt < PAIRING_CODE_MINT_ATTEMPTS; attempt++) {
    const code = mintCode()
    const { changes } = await tx.execute(sql.insertPending, [code, channel, chatId, now, slot])

    if (changes > 0) {
      return { status: 'created', code, expiresAt: now + CODE_TTL_MS }
    }

    const byChat = await findPendingByChat({ tx, sql, channel, chatId, ttlCutoff })

    if (byChat) {
      return { status: 'pending' }
    }

    slot = await claimSlot({ tx, sql, channel, ttlCutoff })
  }

  throw new StorageError('pairing code minting exhausted')
}

interface LookupArgs {
  readonly tx: Transaction
  readonly sql: Sql
  readonly channel: ChannelId
  readonly chatId: string
  readonly ttlCutoff: number
}

async function findPendingByChat(args: LookupArgs): Promise<PendingRow | undefined> {
  const { tx, sql, channel, chatId, ttlCutoff } = args
  const [row] = await tx.query<PendingRow>(sql.findPendingByChat, [channel, chatId, ttlCutoff])

  return row
}

interface SlotArgs {
  readonly tx: Transaction
  readonly sql: Sql
  readonly channel: ChannelId
  readonly ttlCutoff: number
}

// Slots are shared channel-wide, so unpaired chats could otherwise squat every one. When all are
// taken the NEWEST live code yields its slot: reclaiming the oldest instead would let a flood of
// fresh chats delete, one by one, exactly the code the operator is reading off `/pair`.
async function claimSlot(args: SlotArgs): Promise<number> {
  const { tx, sql, channel, ttlCutoff } = args
  const free = await firstFreeSlot(args)

  if (free !== undefined) {
    return free
  }

  const [newest] = await tx.query<ReclaimableSlotRow>(sql.newestPendingSlot, [channel, ttlCutoff])

  if (newest === undefined) {
    throw new StorageError('pairing slots are full with no pending code to reclaim')
  }

  await tx.execute(sql.denyForChannel, [channel, newest.code])

  return newest.pending_slot
}

async function firstFreeSlot(args: SlotArgs): Promise<number | undefined> {
  const { tx, sql, channel, ttlCutoff } = args
  const rows = await tx.query<SlotRow>(sql.listUsedSlots, [channel, ttlCutoff])
  const used = new Set(rows.map((row) => row.pending_slot))

  for (let i = 0; i < PAIRING_MAX_PENDING; i++) {
    if (!used.has(i)) {
      return i
    }
  }

  return undefined
}

function buildSql(d: Dialect): Sql {
  return {
    isPaired:
      `SELECT 1 AS one FROM pairings WHERE channel = ${d.param(1)} AND chat_id = ${d.param(2)} ` +
      `AND status = 'approved' LIMIT 1`,
    findPendingByChat:
      `SELECT code, chat_id, created_at FROM pairings WHERE channel = ${d.param(1)} ` +
      `AND chat_id = ${d.param(2)} AND status = 'pending' AND created_at > ${d.param(3)} LIMIT 1`,
    findPendingByCode:
      `SELECT code, chat_id, created_at FROM pairings WHERE code = ${d.param(1)} ` +
      `AND status = 'pending' AND chat_id IS NOT NULL LIMIT 1`,
    findPendingByChannelCode:
      `SELECT code, chat_id, created_at FROM pairings WHERE channel = ${d.param(1)} ` +
      `AND code = ${d.param(2)} AND status = 'pending' AND chat_id IS NOT NULL LIMIT 1`,
    // No conflict target: chat/slot partial-unique collisions must also yield changes = 0.
    insertPending:
      `INSERT INTO pairings (code, channel, chat_id, created_at, pending_slot) ` +
      `VALUES (${d.paramList(5)}) ON CONFLICT DO NOTHING`,
    approve:
      `UPDATE pairings SET status = 'approved', approved_at = ${d.param(1)}, pending_slot = NULL ` +
      `WHERE code = ${d.param(2)} AND status = 'pending'`,
    approveForChannel:
      `UPDATE pairings SET status = 'approved', approved_at = ${d.param(1)}, pending_slot = NULL ` +
      `WHERE channel = ${d.param(2)} AND code = ${d.param(3)} AND status = 'pending'`,
    deny: `DELETE FROM pairings WHERE code = ${d.param(1)} AND status = 'pending'`,
    denyForChannel:
      `DELETE FROM pairings WHERE channel = ${d.param(1)} AND code = ${d.param(2)} ` +
      `AND status = 'pending'`,
    listPending:
      `SELECT code, chat_id, created_at FROM pairings WHERE channel = ${d.param(1)} ` +
      `AND status = 'pending' AND chat_id IS NOT NULL AND created_at > ${d.param(2)} ` +
      `ORDER BY created_at`,
    revoke: `DELETE FROM pairings WHERE channel = ${d.param(1)} AND chat_id = ${d.param(2)}`,
    deleteExpired:
      `DELETE FROM pairings WHERE channel = ${d.param(1)} AND status = 'pending' ` +
      `AND created_at <= ${d.param(2)}`,
    listUsedSlots:
      `SELECT pending_slot FROM pairings WHERE channel = ${d.param(1)} AND status = 'pending' ` +
      `AND pending_slot IS NOT NULL AND created_at > ${d.param(2)}`,
    newestPendingSlot:
      `SELECT code, pending_slot FROM pairings WHERE channel = ${d.param(1)} ` +
      `AND status = 'pending' AND pending_slot IS NOT NULL AND created_at > ${d.param(2)} ` +
      `ORDER BY created_at DESC LIMIT 1`,
  }
}

function mintCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET.charAt(randomInt(0, CODE_ALPHABET.length))
  }

  return out
}
