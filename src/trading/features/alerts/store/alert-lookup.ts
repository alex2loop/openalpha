import type { AlertId } from '@/trading/kernel/operator/alert'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { alertId } from '@/trading/kernel/operator/alert'

/** Enough to tell one from several; the caller lists at most a few. */
const MATCH_LIMIT = 4

/** Every alert a full id or the tail of one could name. The caller has already held `ref` to the id
 *  pattern, because `LIKE` would read an unfiltered `%` or `_` as a wildcard and could resolve to an
 *  alert the operator never named. `LIKE` cannot use an index, and the pool is bounded. */
export async function listAlertIdsMatching(
  deps: StoreDeps,
  ref: string,
  signal: AbortSignal
): Promise<readonly AlertId[]> {
  assertNotAborted(signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<{ readonly id: string }>(
    `SELECT id FROM alerts WHERE id = ${p(1)} OR id LIKE ${p(2)} ORDER BY id DESC LIMIT ${p(3)}`,
    [ref, `%${ref}`, MATCH_LIMIT]
  )

  return rows.map((row) => alertId(row.id))
}

export async function countActiveAlerts(deps: StoreDeps, signal: AbortSignal): Promise<number> {
  assertNotAborted(signal)

  const rows = await deps.db.query<{ readonly count: number }>(
    "SELECT COUNT(*) AS count FROM alerts WHERE state = 'active'"
  )

  return Number(rows[0]?.count ?? 0)
}
