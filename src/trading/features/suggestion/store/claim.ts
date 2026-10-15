import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'

interface ClaimDeliveryOptions {
  readonly table: string
  readonly dueStates: readonly string[]
  readonly claimState: string
  /** Set when the claimed row binds the day it is delivering (brief subscriptions). */
  readonly deliveryDayColumn?: string
  readonly now: number
  readonly leaseToken: string
  readonly leaseUntil: number
  readonly limit: number
  readonly signal: AbortSignal
}

/** Both delivery tables name their next-attempt column `next_due_at` — one name is what lets this
 *  helper be shared. Postgres takes the batch with `FOR UPDATE SKIP LOCKED` so concurrent claimers
 *  never collide; sqlite is single-writer and uses the plain lease/CAS transition. Both return the
 *  same claimed rows with `attempts` incremented — the optimization never changes claim semantics. */
export async function claimDueRows<TRow>(
  deps: StoreDeps,
  options: ClaimDeliveryOptions
): Promise<readonly TRow[]> {
  assertNotAborted(options.signal)

  const { db, dialect } = deps
  // Interpolated from a boot-time contract tuple, never from request data.
  const states = options.dueStates.map((state) => `'${state}'`).join(',')
  const p = dialect.param

  return db.transaction(async (tx) => {
    assertNotAborted(options.signal)

    const selectSql =
      `SELECT id FROM ${options.table} ` +
      `WHERE state IN (${states}) AND (next_due_at <= ${p(1)} OR lease_until <= ${p(1)}) ` +
      `ORDER BY id LIMIT ${p(2)}` +
      (dialect.name === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : '')
    const due = await tx.query<{ readonly id: string }>(selectSql, [options.now, options.limit])

    if (due.length === 0) {
      return []
    }

    const ids = due.map((row) => row.id)
    // Reclaiming an expired 'delivering' lease finds next_delivery_day already NULL — a plain copy
    // would null the bound delivery day and violate the state CHECK.
    const bindDay =
      options.deliveryDayColumn === undefined
        ? ''
        : `, ${options.deliveryDayColumn} = COALESCE(next_delivery_day, ${options.deliveryDayColumn})` +
          ', next_delivery_day = NULL'
    // Each statement's IN-list placeholders are numbered off the length of its own param array —
    // never a hand-counted offset — so adding a SET column later cannot silently misalign a bind.
    const updateParams: unknown[] = [options.claimState, options.leaseToken, options.leaseUntil]
    const updatePlaceholders = dialect.paramList(ids.length, updateParams.length + 1)

    updateParams.push(...ids)

    // Claiming clears next_due_at: a claimed row carries a lease instead, and a stale due instant
    // would make it re-claimable before that lease expires.
    await tx.execute(
      `UPDATE ${options.table} SET state = ${p(1)}, lease_token = ${p(2)}, lease_until = ${p(3)}, ` +
        `next_due_at = NULL, attempts = attempts + 1${bindDay} ` +
        `WHERE id IN (${updatePlaceholders})`,
      updateParams
    )

    return tx.query<TRow>(
      `SELECT * FROM ${options.table} WHERE id IN (${dialect.paramList(ids.length)})`,
      ids
    )
  })
}
