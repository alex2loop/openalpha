import type { SocialMembershipRow, SocialMembershipState, SocialStore } from '@/core/types/social'
import type { Dialect, Storage } from '@/core/types/storage'
import { agentId } from '@/core/ids'

type MembershipMethods = Pick<
  SocialStore,
  'listMemberships' | 'findMembership' | 'addMembership' | 'removeMembership'
>

type MembershipStateMethods = Pick<
  SocialStore,
  'setMembershipState' | 'setReviewAll' | 'countForbidden' | 'clearForbidden' | 'setCooldown'
>

interface MembershipRecord {
  readonly agent_id: string
  readonly network: string
  readonly public_name: string
  readonly state: string
  readonly review_all: number | string
  readonly interval_ms: number | string | null
  readonly forbidden_streak: number | string
  readonly cooldown_until: number | string | null
  readonly joined_at: number | string
  readonly changed_at: number | string
}

const COLUMNS =
  'agent_id, network, public_name, state, review_all, interval_ms, forbidden_streak, ' +
  'cooldown_until, joined_at, changed_at'

export function createSocialMemberships(db: Storage, dialect: Dialect): MembershipMethods {
  const p = dialect.param

  return {
    async listMemberships(filter) {
      const { where, params } = toFilter(filter, p)
      const rows = await db.query<MembershipRecord>(
        `SELECT ${COLUMNS} FROM social_memberships${where} ORDER BY network, agent_id`,
        params
      )

      return rows.map(toMembershipRow)
    },

    async findMembership(id, network) {
      const rows = await db.query<MembershipRecord>(
        `SELECT ${COLUMNS} FROM social_memberships WHERE agent_id = ${p(1)} AND network = ${p(2)}`,
        [id, network]
      )

      return rows[0] === undefined ? undefined : toMembershipRow(rows[0])
    },

    async addMembership(row) {
      const { changes } = await db.execute(
        `INSERT INTO social_memberships (${COLUMNS}) VALUES ` +
          `(${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(p).join(', ')}) ` +
          'ON CONFLICT (agent_id, network) DO NOTHING',
        toInsertParams(row)
      )

      return changes > 0
    },

    async removeMembership(id, network) {
      const { changes } = await db.execute(
        `DELETE FROM social_memberships WHERE agent_id = ${p(1)} AND network = ${p(2)}`,
        [id, network]
      )

      return changes > 0
    },
  }
}

export function createSocialMembershipState(db: Storage, dialect: Dialect): MembershipStateMethods {
  const p = dialect.param

  return {
    async setMembershipState(id, network, change) {
      // The reset is chosen in code, so no engine has to type a bound parameter inside a CASE.
      const streakReset = change.state === 'active' ? ', forbidden_streak = 0' : ''
      const { changes } = await db.execute(
        `UPDATE social_memberships SET state = ${p(1)}, changed_at = ${p(2)}${streakReset} ` +
          `WHERE agent_id = ${p(3)} AND network = ${p(4)} AND state <> ${p(1)}`,
        [change.state, change.at, id, network]
      )

      return changes > 0
    },

    async setReviewAll(id, network, on) {
      const { changes } = await db.execute(
        `UPDATE social_memberships SET review_all = ${p(1)} ` +
          `WHERE agent_id = ${p(2)} AND network = ${p(3)}`,
        [on ? 1 : 0, id, network]
      )

      return changes > 0
    },

    async countForbidden(id, network) {
      return await db.transaction(async (tx) => {
        await tx.execute(
          `UPDATE social_memberships SET forbidden_streak = forbidden_streak + 1 ` +
            `WHERE agent_id = ${p(1)} AND network = ${p(2)}`,
          [id, network]
        )
        const rows = await tx.query<{ readonly forbidden_streak: number | string }>(
          `SELECT forbidden_streak FROM social_memberships ` +
            `WHERE agent_id = ${p(1)} AND network = ${p(2)}`,
          [id, network]
        )

        return Number(rows[0]?.forbidden_streak ?? 0)
      })
    },

    async clearForbidden(id, network) {
      await db.execute(
        `UPDATE social_memberships SET forbidden_streak = 0 ` +
          `WHERE agent_id = ${p(1)} AND network = ${p(2)} AND forbidden_streak <> 0`,
        [id, network]
      )
    },

    async setCooldown(id, network, until) {
      await db.execute(
        `UPDATE social_memberships SET cooldown_until = ${p(1)} ` +
          `WHERE agent_id = ${p(2)} AND network = ${p(3)}`,
        [until, id, network]
      )
    },
  }
}

function toFilter(
  filter: { readonly agentId?: string; readonly network?: string } | undefined,
  p: Dialect['param']
): { readonly where: string; readonly params: readonly string[] } {
  const clauses: string[] = []
  const params: string[] = []

  if (filter?.agentId !== undefined) {
    params.push(filter.agentId)
    clauses.push(`agent_id = ${p(params.length)}`)
  }

  if (filter?.network !== undefined) {
    params.push(filter.network)
    clauses.push(`network = ${p(params.length)}`)
  }

  return { where: clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`, params }
}

function toInsertParams(row: SocialMembershipRow): readonly (string | number | null)[] {
  return [
    row.agentId,
    row.network,
    row.publicName,
    row.state,
    row.reviewAll ? 1 : 0,
    row.intervalMs ?? null,
    row.forbiddenStreak,
    row.cooldownUntil ?? null,
    row.joinedAt,
    row.changedAt,
  ]
}

function toMembershipRow(row: MembershipRecord): SocialMembershipRow {
  return {
    agentId: agentId(row.agent_id),
    network: row.network,
    publicName: row.public_name,
    // why-safe: the CHECK constraint admits only the union members.
    state: row.state as SocialMembershipState,
    reviewAll: Number(row.review_all) === 1,
    ...(row.interval_ms === null ? {} : { intervalMs: Number(row.interval_ms) }),
    forbiddenStreak: Number(row.forbidden_streak),
    ...(row.cooldown_until === null ? {} : { cooldownUntil: Number(row.cooldown_until) }),
    joinedAt: Number(row.joined_at),
    changedAt: Number(row.changed_at),
  }
}
