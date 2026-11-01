import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketEvent, MarketEventKind } from '@/trading/kernel/market/market-event'

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
