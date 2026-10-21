import type { SuggestionStoreDeps } from '@/trading/features/suggestion/store/readable-row'
import type { SuggestionRow } from '@/trading/features/suggestion/store/suggestion-row'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { MarketRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { readableRow } from '@/trading/features/suggestion/store/readable-row'
import { toSuggestion } from '@/trading/features/suggestion/store/suggestion-row'
import { framedDirectionOf, planStopOf } from '@/trading/features/suggestion/types'
import { DEFAULT_FOCUS_KEY } from '@/trading/kernel/operator/focus'

/** How many rows back the exit plan is looked for once the newest one names no long stop. It has
 *  only to cross a run of declined reduces or level-less holds, and a stored payload is tens of
 *  kilobytes, so the window is read only on that path and never on the common one. */
const EXIT_PLAN_LOOKBACK_ROWS = 10
const PLAN_ACTIONS = "'buy', 'hold'"
const PLAN_OR_SALE_ACTIONS = "'buy', 'hold', 'reduce'"

export interface FindLatestExitPlanOptions {
  readonly market: MarketRef
  readonly ticker: Ticker
  /** Widens the read to the newest row of any status, for the floor a new plan's stop must not sit
   *  under. Omitted, only an unresolved row answers. */
  readonly includeResolved?: boolean
  /** The day the holding as it stands opened. A plan written before it belongs to a holding
   *  already closed, and its levels were never this one's. */
  readonly heldSince?: TradingDay
  readonly signal: AbortSignal
}

/** The stored row whose levels an exit watch tests for this name: the newest buy or hold that
 *  frames a long and names a stop, so the plan `/suggest` last printed is the one every alert, stop
 *  distance and re-plan reads. A newer row cannot lower the stop: it was ratcheted against this one
 *  when it was priced. Reduces stay unwatched by design: their levels are inverted, and a blocked
 *  reduce kept as a hold names a stop above the market, so it is passed over rather than answered
 *  with - the plan under it still stands. A hold the market priced no levels for is passed over the
 *  same way. Excludes a row whose outcome already resolved: once the stop or target has been hit,
 *  those levels are settled history. With no such plan left, a sale that took over the plan's row
 *  that day answers through its standing exit. */
export async function findLatestExitPlan(
  deps: SuggestionStoreDeps,
  options: FindLatestExitPlanOptions
): Promise<StoredSuggestion | null> {
  assertNotAborted(options.signal)

  const newestRows = await findLatestPlanRows(deps, options, {
    limit: 1,
    actions: PLAN_OR_SALE_ACTIONS,
  })

  if (newestRows.length === 0) {
    return null
  }

  // An unreadable newest row is passed over like a level-less one: the plan under it still stands.
  const newest = newestRows.flatMap((row) => readableRow(row, toSuggestion, deps.logger))[0]

  if (newest !== undefined && isExitPlan(newest)) {
    return newest
  }

  const recentRows = await findLatestPlanRows(deps, options, {
    limit: EXIT_PLAN_LOOKBACK_ROWS,
    actions: PLAN_ACTIONS,
  })
  const recent = recentRows.flatMap((row) => readableRow(row, toSuggestion, deps.logger))

  return recent.find(isExitPlan) ?? standingPlanOf(newest) ?? null
}

function isExitPlan(suggestion: StoredSuggestion): boolean {
  return framedDirectionOf(suggestion) === 'buy' && planStopOf(suggestion) !== undefined
}

/** A same-day sale takes over the plan row it was priced against, keeping that plan's exits as
 *  `standingExit`; the rest of the position is watched against those, never the sale's own levels. */
function standingPlanOf(sale: StoredSuggestion | undefined): StoredSuggestion | undefined {
  if (sale === undefined || sale.standingExit === undefined || isExitPlan(sale)) {
    return undefined
  }

  const { stop, takeProfit } = sale.standingExit
  const { trailingStop: _trailed, standingTakeProfit: _banked, outcome: _scored, ...base } = sale

  return {
    ...base,
    action: 'hold',
    direction: 'buy',
    holdReasonCodes: sale.action === 'hold' ? sale.holdReasonCodes : [],
    stop,
    takeProfit,
    target: takeProfit,
  }
}

async function findLatestPlanRows(
  deps: StoreDeps,
  options: FindLatestExitPlanOptions,
  window: { readonly limit: number; readonly actions: string }
): Promise<readonly SuggestionRow[]> {
  const p = deps.dialect.param
  // A restated call keeps its old-basis levels with no return, so it is never a floor either.
  const status =
    options.includeResolved === true
      ? 'AND (outcome_status IS NULL OR return_pct IS NOT NULL) '
      : 'AND outcome_status IS NULL '
  const since = options.heldSince === undefined ? '' : `AND day >= ${p(4)} `

  // One book, one plan: a focus call never stands in for the operator's.
  return deps.db.query<SuggestionRow>(
    `SELECT * FROM suggestions WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
      `AND focus_key = ${p(3)} AND action IN (${window.actions}) ` +
      `${status}${since}ORDER BY created_at DESC LIMIT ${window.limit}`,
    options.heldSince === undefined
      ? [options.market, options.ticker, DEFAULT_FOCUS_KEY]
      : [options.market, options.ticker, DEFAULT_FOCUS_KEY, options.heldSince]
  )
}
