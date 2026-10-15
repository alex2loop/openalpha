import type { SocialStore, SocialWriteRow } from '@/core/types/social'
import type { Dialect, Storage } from '@/core/types/storage'
import { agentId } from '@/core/ids'

type WriteMethods = Pick<
  SocialStore,
  'recordWrite' | 'countWrites' | 'hasWrite' | 'listWrites' | 'pruneWrites'
>

interface WriteRecord {
  readonly id: string
  readonly agent_id: string
  readonly network: string
  readonly label: string
  readonly body_hash: string
  readonly excerpt: string
  readonly returned_id: string | null
  readonly at: number | string
}

const COLUMNS = 'id, agent_id, network, label, body_hash, excerpt, returned_id, at'

export function createSocialWrites(db: Storage, dialect: Dialect): WriteMethods {
  const p = dialect.param
  const values = COLUMNS.split(', ')
    .map((_, index) => p(index + 1))
    .join(', ')

  return {
    async recordWrite(row) {
      await db.execute(
        `INSERT INTO social_writes (${COLUMNS}) VALUES (${values})`,
        toInsertParams(row)
      )
    },

    async countWrites(scope) {
      const rows = await db.query<{ readonly n: number | string }>(
        `SELECT COUNT(*) AS n FROM social_writes ` +
          `WHERE agent_id = ${p(1)} AND network = ${p(2)} AND label = ${p(3)} AND at >= ${p(4)}`,
        [scope.agentId, scope.network, scope.label, scope.since]
      )

      return Number(rows[0]?.n ?? 0)
    },

    async hasWrite(scope) {
      const rows = await db.query<{ readonly one: number }>(
        `SELECT 1 AS one FROM social_writes WHERE agent_id = ${p(1)} AND network = ${p(2)} ` +
          `AND body_hash = ${p(3)} AND at >= ${p(4)} LIMIT 1`,
        [scope.agentId, scope.network, scope.bodyHash, scope.since]
      )

      return rows.length > 0
    },

    async listWrites(scope) {
      const params: (string | number)[] = [scope.agentId]
      let networkClause = ''

      if (scope.network !== undefined) {
        params.push(scope.network)
        networkClause = ` AND network = ${p(params.length)}`
      }

      params.push(scope.limit)
      const rows = await db.query<WriteRecord>(
        `SELECT ${COLUMNS} FROM social_writes WHERE agent_id = ${p(1)}${networkClause} ` +
          `ORDER BY at DESC LIMIT ${p(params.length)}`,
        params
      )

      return rows.map(toWriteRow)
    },

    async pruneWrites(before) {
      const { changes } = await db.execute(`DELETE FROM social_writes WHERE at < ${p(1)}`, [before])

      return changes
    },
  }
}

function toInsertParams(row: SocialWriteRow): readonly (string | number | null)[] {
  return [
    row.id,
    row.agentId,
    row.network,
    row.label,
    row.bodyHash,
    row.excerpt,
    row.returnedId ?? null,
    row.at,
  ]
}

function toWriteRow(row: WriteRecord): SocialWriteRow {
  return {
    id: row.id,
    agentId: agentId(row.agent_id),
    network: row.network,
    label: row.label,
    bodyHash: row.body_hash,
    excerpt: row.excerpt,
    ...(row.returned_id === null ? {} : { returnedId: row.returned_id }),
    at: Number(row.at),
  }
}
