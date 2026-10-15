import type {
  SocialNetworkRow,
  SocialNetworkState,
  SocialPauseReason,
  SocialStore,
} from '@/core/types/social'
import type { Dialect, Storage } from '@/core/types/storage'

type NetworkMethods = Pick<
  SocialStore,
  'listNetworks' | 'findNetwork' | 'addNetwork' | 'removeNetwork' | 'setNetworkState'
>

interface NetworkRecord {
  readonly name: string
  readonly state: string
  readonly pause_reason: string | null
  readonly added_at: number | string
  readonly changed_at: number | string
}

const COLUMNS = 'name, state, pause_reason, added_at, changed_at'

export function createSocialNetworks(db: Storage, dialect: Dialect): NetworkMethods {
  const p = dialect.param

  return {
    async listNetworks() {
      const rows = await db.query<NetworkRecord>(
        `SELECT ${COLUMNS} FROM social_networks ORDER BY name`
      )

      return rows.map(toNetworkRow)
    },

    async findNetwork(name) {
      const rows = await db.query<NetworkRecord>(
        `SELECT ${COLUMNS} FROM social_networks WHERE name = ${p(1)}`,
        [name]
      )

      return rows[0] === undefined ? undefined : toNetworkRow(rows[0])
    },

    async addNetwork(name, at) {
      const { changes } = await db.execute(
        `INSERT INTO social_networks (name, state, added_at, changed_at) ` +
          `VALUES (${p(1)}, 'active', ${p(2)}, ${p(3)}) ON CONFLICT (name) DO NOTHING`,
        [name, at, at]
      )

      return changes > 0
    },

    async removeNetwork(name) {
      const { changes } = await db.execute(`DELETE FROM social_networks WHERE name = ${p(1)}`, [
        name,
      ])

      return changes > 0
    },

    async setNetworkState(name, state, change) {
      const { changes } = await db.execute(
        `UPDATE social_networks SET state = ${p(1)}, pause_reason = ${p(2)}, ` +
          `changed_at = ${p(3)} WHERE name = ${p(4)} AND state <> ${p(5)}`,
        [state, state === 'paused' ? (change.reason ?? 'operator') : null, change.at, name, state]
      )

      return changes > 0
    },
  }
}

function toNetworkRow(row: NetworkRecord): SocialNetworkRow {
  return {
    name: row.name,
    // why-safe: the CHECK constraint admits only the union members.
    state: row.state as SocialNetworkState,
    ...(row.pause_reason === null
      ? {}
      : // why-safe: the CHECK constraint admits only the union members.
        { pauseReason: row.pause_reason as SocialPauseReason }),
    addedAt: Number(row.added_at),
    changedAt: Number(row.changed_at),
  }
}
