import type { ChannelId } from '@/core/channels'
import type { Dialect, Storage } from '@/core/types/storage'
import { channelId } from '@/core/channels'
import { StorageError, ValidationError } from '@/core/errors'

const MAX_CLAIM_LIMIT = 1_000

type InboxStatus = 'pending' | 'processing' | 'completed' | 'failed'
type InboxCompletion = 'completed' | 'lost'
type InboxFailureDisposition = 'retried' | 'dead-lettered' | 'lost'

interface InboxRecoveryCounts {
  readonly requeued: number
  readonly deadLettered: number
}

interface ChannelInboxEntry {
  readonly channel: ChannelId
  readonly updateId: string
  readonly payload: string
  readonly status: InboxStatus
  readonly acceptedAt: number
  readonly startedAt: number | null
  readonly completedAt: number | null
  readonly error: string | null
  readonly answer: string | null
}

// Persistence cannot import its consumer without reversing the DAG. The composition root assigns
// this structural provider to channels' InboundInbox interface, where TypeScript verifies conformance.
interface ChannelInboxStore {
  accept(input: {
    readonly channel: ChannelId
    readonly updateId: string
    readonly payload: string
    readonly acceptedAt: number
  }): Promise<'accepted' | 'duplicate'>
  claimPending(input: {
    readonly channel: ChannelId
    readonly limit: number
    readonly startedAt: number
    readonly token: string
  }): Promise<readonly ChannelInboxEntry[]>
  complete(input: {
    readonly channel: ChannelId
    readonly updateId: string
    readonly completedAt: number
    readonly token: string
  }): Promise<InboxCompletion>
  failAttempt(input: {
    readonly channel: ChannelId
    readonly updateId: string
    readonly token: string
    readonly error: string
    readonly failedAt: number
    readonly maxAttempts: number
    readonly answer?: string
  }): Promise<InboxFailureDisposition>
  releaseClaim(input: {
    readonly channel: ChannelId
    readonly updateId: string
    readonly token: string
  }): Promise<void>
  renewClaims(input: {
    readonly channel: ChannelId
    readonly token: string
    readonly renewedAt: number
  }): Promise<void>
  recoverStalled(input: {
    readonly channel: ChannelId
    readonly error: string
    readonly recoveredAt: number
    readonly maxAttempts: number
    readonly stalledBefore: number
  }): Promise<InboxRecoveryCounts>
}

interface InboxRow {
  readonly channel: string
  readonly update_id: string
  readonly payload: string
  readonly status: string
  readonly accepted_at: number
  readonly started_at: number | null
  readonly completed_at: number | null
  readonly error: string | null
  readonly answer: string | null
}

interface InboxSql {
  readonly accept: string
  readonly claimPending: string
  readonly complete: string
  readonly failAttempt: string
  readonly releaseClaim: string
  readonly renewClaims: string
  readonly recoverStalled: string
}

interface StatusRow {
  readonly status: string
}

export function createChannelInbox(db: Storage, dialect: Dialect): ChannelInboxStore {
  const sql = buildSql(dialect)

  return {
    async accept(input) {
      const { changes } = await db.execute(sql.accept, [
        input.channel,
        input.updateId,
        input.payload,
        input.acceptedAt,
      ])
      return changes > 0 ? 'accepted' : 'duplicate'
    },

    async claimPending(input) {
      assertClaimLimit(input.limit)
      const rows = await db.query<InboxRow>(sql.claimPending, [
        input.startedAt,
        input.token,
        input.channel,
        input.limit,
      ])

      return rows.map(toEntry).sort(compareEntries)
    },

    complete: (input) => complete(db, sql.complete, input),

    async failAttempt(input) {
      assertMaxAttempts(input.maxAttempts)
      const rows = await db.query<StatusRow>(sql.failAttempt, [
        input.maxAttempts,
        input.failedAt,
        input.error,
        input.channel,
        input.updateId,
        input.token,
        input.answer ?? null,
      ])
      const status = rows[0]?.status

      return status === undefined ? 'lost' : toFailureDisposition(status)
    },

    releaseClaim: (input) => releaseClaim(db, sql.releaseClaim, input),

    renewClaims: (input) => renewClaims(db, sql.renewClaims, input),

    async recoverStalled(input) {
      assertMaxAttempts(input.maxAttempts)
      const rows = await db.query<StatusRow>(sql.recoverStalled, [
        input.maxAttempts,
        input.recoveredAt,
        input.error,
        input.channel,
        input.stalledBefore,
      ])

      return countRecoveryStatuses(rows)
    },
  }
}

async function complete(
  db: Storage,
  sql: string,
  input: {
    readonly channel: ChannelId
    readonly updateId: string
    readonly completedAt: number
    readonly token: string
  }
): Promise<InboxCompletion> {
  const { changes } = await db.execute(sql, [
    input.completedAt,
    input.channel,
    input.updateId,
    input.token,
  ])

  return changes > 0 ? 'completed' : 'lost'
}

async function releaseClaim(
  db: Storage,
  sql: string,
  input: { readonly channel: ChannelId; readonly updateId: string; readonly token: string }
): Promise<void> {
  await db.execute(sql, [input.channel, input.updateId, input.token])
}

async function renewClaims(
  db: Storage,
  sql: string,
  input: { readonly channel: ChannelId; readonly token: string; readonly renewedAt: number }
): Promise<void> {
  await db.execute(sql, [input.renewedAt, input.channel, input.token])
}

function assertClaimLimit(limit: number): void {
  if (!(Number.isSafeInteger(limit) && limit > 0 && limit <= MAX_CLAIM_LIMIT)) {
    throw new ValidationError(`inbox claim limit must be an integer from 1 to ${MAX_CLAIM_LIMIT}`)
  }
}

function assertMaxAttempts(maxAttempts: number): void {
  if (!(Number.isSafeInteger(maxAttempts) && maxAttempts > 0)) {
    throw new ValidationError('inbox max attempts must be a positive safe integer')
  }
}

function toFailureDisposition(status: string): InboxFailureDisposition {
  if (status === 'pending') {
    return 'retried'
  }

  if (status === 'failed') {
    return 'dead-lettered'
  }

  throw new StorageError('channel inbox failure transition returned an invalid status')
}

function countRecoveryStatuses(rows: readonly StatusRow[]): InboxRecoveryCounts {
  let requeued = 0
  let deadLettered = 0
  for (const row of rows) {
    if (row.status === 'pending') {
      requeued += 1
      continue
    }

    if (row.status === 'failed') {
      deadLettered += 1
      continue
    }

    throw new StorageError('channel inbox recovery returned an invalid status')
  }
  return { requeued, deadLettered }
}

function toEntry(row: InboxRow): ChannelInboxEntry {
  if (!isInboxStatus(row.status)) {
    throw new StorageError('channel inbox returned an invalid row')
  }

  try {
    return {
      channel: channelId(row.channel),
      updateId: row.update_id,
      payload: row.payload,
      status: row.status,
      acceptedAt: row.accepted_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
      answer: row.answer,
    }
  } catch (err: unknown) {
    throw new StorageError('channel inbox returned an invalid row', err)
  }
}

function isInboxStatus(value: string): value is InboxStatus {
  return (
    value === 'pending' || value === 'processing' || value === 'completed' || value === 'failed'
  )
}

function compareEntries(left: ChannelInboxEntry, right: ChannelInboxEntry): number {
  return left.acceptedAt - right.acceptedAt || left.updateId.localeCompare(right.updateId)
}

function buildSql(dialect: Dialect): InboxSql {
  return {
    accept: buildAcceptSql(dialect),
    claimPending:
      dialect.name === 'postgres' ? buildPostgresClaimSql(dialect) : buildSqliteClaimSql(dialect),
    complete:
      `UPDATE channel_inbox SET status = 'completed', completed_at = ${dialect.param(1)}, ` +
      `claim_token = NULL, error = NULL, answer = NULL ` +
      `WHERE channel = ${dialect.param(2)} AND update_id = ${dialect.param(3)} ` +
      `AND status = 'processing' AND claim_token = ${dialect.param(4)}`,
    failAttempt: buildRetryTransitionSql(
      dialect,
      `channel = ${dialect.param(4)} AND update_id = ${dialect.param(5)} ` +
        `AND status = 'processing' AND claim_token = ${dialect.param(6)}`,
      `, answer = COALESCE(${dialect.param(7)}, answer)`
    ),
    // Undoes the claim's attempt_count increment: an entry given back untouched must not have
    // spent one of its retries.
    releaseClaim:
      `UPDATE channel_inbox SET status = 'pending', started_at = NULL, claim_token = NULL, ` +
      `attempt_count = CASE WHEN attempt_count > 0 THEN attempt_count - 1 ELSE 0 END ` +
      `WHERE channel = ${dialect.param(1)} AND update_id = ${dialect.param(2)} ` +
      `AND status = 'processing' AND claim_token = ${dialect.param(3)}`,
    renewClaims:
      `UPDATE channel_inbox SET started_at = ${dialect.param(1)} ` +
      `WHERE channel = ${dialect.param(2)} AND status = 'processing' ` +
      `AND claim_token = ${dialect.param(3)}`,
    recoverStalled: buildRetryTransitionSql(
      dialect,
      `channel = ${dialect.param(4)} AND status = 'processing' AND started_at < ${dialect.param(5)}`
    ),
  }
}

function buildRetryTransitionSql(dialect: Dialect, where: string, extraSet = ''): string {
  const canRetry = `attempt_count < ${dialect.param(1)}`

  return (
    `UPDATE channel_inbox SET status = CASE WHEN ${canRetry} THEN 'pending' ELSE 'failed' END, ` +
    `started_at = NULL, claim_token = NULL, ` +
    `completed_at = CASE WHEN ${canRetry} THEN NULL ELSE CAST(${dialect.param(2)} AS BIGINT) END, ` +
    `error = ${dialect.param(3)}${extraSet} WHERE ${where} RETURNING status`
  )
}

function buildAcceptSql(dialect: Dialect): string {
  return (
    `INSERT INTO channel_inbox (channel, update_id, payload, status, accepted_at) ` +
    `VALUES (${dialect.param(1)}, ${dialect.param(2)}, ${dialect.param(3)}, 'pending', ` +
    `${dialect.param(4)}) ON CONFLICT (channel, update_id) DO NOTHING`
  )
}

function buildPostgresClaimSql(dialect: Dialect): string {
  return (
    `WITH pending AS (SELECT channel, update_id FROM channel_inbox ` +
    `WHERE channel = ${dialect.param(3)} AND status = 'pending' ` +
    `ORDER BY accepted_at ASC, update_id ASC FOR UPDATE SKIP LOCKED LIMIT ${dialect.param(4)}) ` +
    `UPDATE channel_inbox AS inbox SET status = 'processing', started_at = ${dialect.param(1)}, ` +
    `claim_token = ${dialect.param(2)}, attempt_count = inbox.attempt_count + 1 ` +
    `FROM pending WHERE inbox.channel = pending.channel AND inbox.update_id = pending.update_id ` +
    `AND inbox.status = 'pending' RETURNING inbox.channel, inbox.update_id, inbox.payload, ` +
    `inbox.status, inbox.accepted_at, inbox.started_at, inbox.completed_at, inbox.error, ` +
    `inbox.answer`
  )
}

function buildSqliteClaimSql(dialect: Dialect): string {
  return (
    `UPDATE channel_inbox SET status = 'processing', started_at = ${dialect.param(1)}, ` +
    `claim_token = ${dialect.param(2)}, attempt_count = attempt_count + 1 ` +
    `WHERE (channel, update_id) IN (SELECT channel, update_id FROM channel_inbox ` +
    `WHERE channel = ${dialect.param(3)} AND status = 'pending' ` +
    `ORDER BY accepted_at ASC, update_id ASC LIMIT ${dialect.param(4)}) ` +
    `AND status = 'pending' RETURNING channel, update_id, payload, status, accepted_at, ` +
    `started_at, completed_at, error, answer`
  )
}
