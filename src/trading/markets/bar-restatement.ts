import type { TradingDay } from '@/trading/kernel/instrument'
import type { BarRecord } from '@/trading/kernel/market/market-data'

/** How far a price may sit from the same session's before the series counts as restated. Wide
 *  enough to absorb a provider's own rounding, far under any corporate action's step. */
export const RESTATEMENT_TOLERANCE = 0.001

/** How much of an already-stored window a refresh re-asks for. A restatement is invisible to a pass
 *  that only fetches days it does not hold, and one session of overlap would miss an action
 *  announced over a weekend. */
export const RESTATEMENT_TAIL_SESSIONS = 20

/** Any day the provider now publishes under a different close than the one stored, so the whole
 *  window is refetched for that name. Every overlapping session is checked, not the newest alone: a
 *  provider re-basing a name after its ex-date changes only the sessions before it. A day held on
 *  one side only is a name that did not trade or one fetched for the first time - neither is
 *  evidence of a restatement. */
export function isRestated(
  stored: ReadonlyMap<TradingDay, number> | undefined,
  records: readonly BarRecord[] | undefined
): boolean {
  return (records ?? []).some((record) => {
    const close = stored?.get(record.candle.at)

    return (
      close !== undefined && Math.abs(record.candle.close - close) / close > RESTATEMENT_TOLERANCE
    )
  })
}
