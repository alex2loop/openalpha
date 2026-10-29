import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketEvent, MarketEventKind } from '@/trading/kernel/market/market-event'

/** How far back a margin-list row still describes today. HOSE republishes the list quarterly, so
 *  two cycles reach a row that took effect at the start of the previous one. */
const MARGIN_STATUS_LOOKBACK_SESSIONS = 130

/** The first day a name's events read reaches back to: the one owner of the window, so a reader of
 *  past events can tell what the read could not have covered. */
export function eventsFromDay(
  calendar: { addTradingDays(day: TradingDay, count: number): TradingDay },
  asOf: TradingDay
): TradingDay {
  return calendar.addTradingDays(asOf, -MARGIN_STATUS_LOOKBACK_SESSIONS)
}

const MARGIN_EVENT_KINDS: ReadonlySet<MarketEventKind> = new Set([
  'margin-eligible',
  'margin-ineligible',
])

/** The newest margin event that took effect before `asOf`. One landing on `asOf` itself is that
 *  day's news and travels with the upcoming rows instead. Absent means unknown, never eligible. */
export function standingMarginEvent(
  events: readonly MarketEvent[],
  asOf: TradingDay
): MarketEvent | undefined {
  let standing: MarketEvent | undefined

  for (const event of events) {
    if (!MARGIN_EVENT_KINDS.has(event.kind) || event.at >= asOf) {
      continue
    }

    if (standing === undefined || event.at > standing.at) {
      standing = event
    }
  }

  return standing
}
