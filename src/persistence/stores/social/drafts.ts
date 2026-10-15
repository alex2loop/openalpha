import type { SocialDraftReason, SocialDraftRow, SocialStore } from '@/core/types/social'
import type { Dialect, Storage } from '@/core/types/storage'
import { agentId } from '@/core/ids'

type DraftReadMethods = Pick<SocialStore, 'listDrafts' | 'findDraft'>

type DraftWriteMethods = Pick<
  SocialStore,
  'addDraft' | 'removeDraft' | 'removeDrafts' | 'pruneDrafts'
>

interface DraftRecord {
  readonly id: string
  readonly agent_id: string
  readonly network: string
  readonly method: string
  readonly path: string
  readonly query: string | null
  readonly body: string | null
  readonly reason: string
  readonly pin_id: string
  readonly created_at: number | string
  readonly expires_at: number | string
}

const COLUMNS =
  'id, agent_id, network, method, path, query, body, reason, pin_id, created_at, expires_at'

export function createSocialDraftReads(db: Storage, dialect: Dialect): DraftReadMethods {
  const p = dialect.param

  return {
    async listDrafts(now) {
      const rows = await db.query<DraftRecord>(
        `SELECT ${COLUMNS} FROM social_drafts WHERE expires_at > ${p(1)} ORDER BY created_at`,
        [now]
      )

      return rows.map(toDraftRow)
    },

    async findDraft(id) {
      const rows = await db.query<DraftRecord>(
        `SELECT ${COLUMNS} FROM social_drafts WHERE id = ${p(1)}`,
        [id]
      )

      return rows[0] === undefined ? undefined : toDraftRow(rows[0])
    },
  }
}

export function createSocialDraftWrites(db: Storage, dialect: Dialect): DraftWriteMethods {
  const p = dialect.param

  return {
    async addDraft(row) {
      await db.execute(
        `INSERT INTO social_drafts (${COLUMNS}) VALUES ` +
          `(${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(p).join(', ')})`,
        [
          row.id,
          row.agentId,
          row.network,
          row.method,
          row.path,
          row.query === undefined ? null : JSON.stringify(row.query),
          row.body ?? null,
          row.reason,
          row.pinId,
          row.createdAt,
          row.expiresAt,
        ]
      )
    },

    async removeDraft(id) {
      const { changes } = await db.execute(`DELETE FROM social_drafts WHERE id = ${p(1)}`, [id])

      return changes > 0
    },

    async removeDrafts(id, network) {
      const { changes } = await db.execute(
        `DELETE FROM social_drafts WHERE agent_id = ${p(1)} AND network = ${p(2)}`,
        [id, network]
      )

      return changes
    },

    async pruneDrafts(now) {
      const { changes } = await db.execute(
        `DELETE FROM social_drafts WHERE expires_at <= ${p(1)}`,
        [now]
      )

      return changes
    },
  }
}

function toDraftRow(row: DraftRecord): SocialDraftRow {
  const query = parseQuery(row.query)

  return {
    id: row.id,
    agentId: agentId(row.agent_id),
    network: row.network,
    method: row.method,
    path: row.path,
    ...(query === undefined ? {} : { query }),
    ...(row.body === null ? {} : { body: row.body }),
    // why-safe: the CHECK constraint admits only the union members.
    reason: row.reason as SocialDraftReason,
    pinId: row.pin_id,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
  }
}

// A damaged value reads as no query: a draft is re-checked in full at approval anyway.
function parseQuery(raw: string | null): Readonly<Record<string, string>> | undefined {
  if (raw === null) {
    return undefined
  }

  try {
    // why-safe: written by `addDraft` from a string record, and re-checked at approval.
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return undefined
  }
}
