import type { Caveat } from '@/trading/kernel/caveat'
import type { QuoteFreshness } from '@/trading/kernel/market/market-data'
import type { Market, TradingCalendar } from '@/trading/markets/types'
import { isLiveObservation } from '@/trading/markets/calendar'

/** The calendar answers which session the reading belongs to; the timezone only decides how the
 *  clock is written. Keeping them apart is what lets a crypto reading keep its UTC trading day
 *  while printing in the operator's local time. */
export function freshnessOf(
  source: { readonly calendar: TradingCalendar; readonly timezone: string },
  observedAt: number,
  now: number
): QuoteFreshness {
  const { calendar } = source

  return {
    kind: isLiveObservation(calendar, observedAt, now) ? 'live' : 'close',
    day: calendar.dayAt(observedAt),
    observedAt,
  }
}

/** The honest floor of the EOD-only decision: a board or overview served mid-session was ranked on
 *  the last settled snapshot, and nothing else tells the operator that. A continuous market carries
 *  the gap permanently — it is always mid-session — rather than being exempt from it. */
export function settledEvidenceCaveats(market: Market, now: number): readonly Caveat[] {
  if (market.manifest.calendar.sessionState(now) !== 'open') {
    return []
  }

  return [{ code: 'market-data.evidence-settled-only' }]
}
