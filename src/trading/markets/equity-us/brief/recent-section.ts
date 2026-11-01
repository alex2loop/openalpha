import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketEvent, MarketEventKind } from '@/trading/kernel/market/market-event'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/brief-context'
import type { DatedEvent } from '@/trading/markets/brief-events'
import { absent, omitted, ready } from '@/trading/markets/brief-sections'

const FILED_KINDS: readonly MarketEventKind[] = ['earnings-release', 'insider-purchase']

/** What a name the operator holds or watches just filed, and the ex-dividend dates ahead, cut from
 *  the calendar the context read once. */
export async function buildRecent(context: BriefContext): Promise<BriefSectionResult> {
  if (context.calendarNames.names.length === 0) {
    return omitted('recent')
  }

  const { asOf } = context.request
  const read = await context.events()
  const rows = read.rows.filter((row) => isRecent(row.event, asOf))

  if (rows.length === 0) {
    // A quiet filing calendar is only observable when every target answered.
    return read.isComplete ? omitted('recent') : absent('recent', read.caveats)
  }

  return ready(
    'recent',
    nearestFirst(rows, asOf, context.policy.maximumItemsPerSection).map((row) => ({
      at: row.event.at,
      ticker: row.instrument.ticker,
      eventKind: row.event.kind,
    })),
    { caveats: read.caveats, provenance: read.provenance }
  )
}

/** A filing already out and an ex-date still ahead; a past ex-date is not news. */
function isRecent(event: MarketEvent, asOf: TradingDay): boolean {
  return FILED_KINDS.includes(event.kind)
    ? event.at <= asOf
    : event.kind === 'dividend-ex-date' && event.at >= asOf
}

/** The cap keeps the dates closest to today, then reads in date order: keeping the oldest would
 *  drop the newest filings and the nearest ex-dates, which are the news. */
function nearestFirst(
  rows: readonly DatedEvent[],
  asOf: TradingDay,
  limit: number
): readonly DatedEvent[] {
  const asOfMs = Date.parse(asOf)

  return rows
    .toSorted(
      (left, right) =>
        Math.abs(Date.parse(left.event.at) - asOfMs) - Math.abs(Date.parse(right.event.at) - asOfMs)
    )
    .slice(0, limit)
    .toSorted(
      (left, right) =>
        left.event.at.localeCompare(right.event.at) ||
        left.instrument.ticker.localeCompare(right.instrument.ticker)
    )
}
