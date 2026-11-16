import type { Caveat } from '@/trading/kernel/caveat'
import type { CurrencyCode, TradingDay } from '@/trading/kernel/instrument'
import type { MarketEvent, MarketEventKind } from '@/trading/kernel/market/market-event'
import type { BriefSectionResult, BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/brief-context'
import type { DatedEvent } from '@/trading/markets/brief-events'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { FILED_EVENT_KINDS, isFlaggedFiling } from '@/trading/kernel/market/market-event'
import { sourceId } from '@/trading/kernel/source/source-id'
import { absent, omitted, ready } from '@/trading/markets/brief-sections'

const UPCOMING_KINDS: readonly MarketEventKind[] = ['dividend-ex-date', 'earnings-date']
/** The events provider that dates filings: registered only when the SEC contact is set, while
 *  Nasdaq's ex-dates answer without one. */
const FILINGS_SOURCE = sourceId('sec-data')
const FILINGS_UNCONFIGURED: Caveat = { code: 'brief.filings-unconfigured' }

/** What a name the operator holds or watches just filed (earnings, insider buying, a flagged 8-K),
 *  and the ex-dividend dates and earnings reports ahead, cut from the calendar the context read
 *  once. */
export async function buildRecent(context: BriefContext): Promise<BriefSectionResult> {
  if (context.calendarNames.names.length === 0) {
    return omitted('recent')
  }

  const { asOf } = context.request
  const read = await context.events()
  const filingsOn = context.deps.sources
    .list()
    .some((source) => source.kind === 'events' && source.id === FILINGS_SOURCE)
  // Without filings an empty list says nothing about them, so the operator is told how to turn them on.
  const caveats = filingsOn ? read.caveats : dedupeCaveats([...read.caveats, FILINGS_UNCONFIGURED])
  const rows = read.rows.filter((row) => isRecent(row.event, asOf))

  if (rows.length === 0) {
    // A quiet filing calendar is only observable when every target answered.
    return read.isComplete && filingsOn ? omitted('recent') : absent('recent', caveats)
  }

  const shown = capped(rows, asOf, context.policy.maximumItemsPerSection)

  return ready('recent', shown.map(toRow), {
    caveats,
    provenance: read.provenance,
    ...forecastCurrency(shown),
  })
}

/** A filing already out and an ex-date or a report still ahead; a past one is not news. */
function isRecent(event: MarketEvent, asOf: TradingDay): boolean {
  if (FILED_EVENT_KINDS.includes(event.kind)) {
    return event.at <= asOf
  }

  return UPCOMING_KINDS.includes(event.kind) && event.at >= asOf
}

function toRow({ event, instrument }: DatedEvent): BriefSectionRow {
  const { earnings } = event

  return {
    at: event.at,
    ticker: instrument.ticker,
    eventKind: event.kind,
    ...(earnings?.timing === undefined ? {} : { timing: earnings.timing }),
    ...(earnings?.epsForecast === undefined ? {} : { epsForecast: earnings.epsForecast }),
  }
}

/** The forecasts print in the currency the calendar stated them in. */
function forecastCurrency(rows: readonly DatedEvent[]): { readonly currency?: CurrencyCode } {
  const stated = rows.find((row) => row.event.earnings?.epsForecast !== undefined)
  const currency = stated?.event.earnings?.currency

  return currency === undefined ? {} : { currency }
}

/** Every flagged filing is kept, held or watched (a held name's next action points to it), so the
 *  list can run past the cap; the rest of the cap takes the dates closest to today, read in date
 *  order: keeping the oldest would drop the newest filings and the nearest ex-dates, the news. */
function capped(
  rows: readonly DatedEvent[],
  asOf: TradingDay,
  limit: number
): readonly DatedEvent[] {
  const asOfMs = Date.parse(asOf)
  const flagged = rows.filter(({ event }) => isFlaggedFiling(event))
  const nearest = rows
    .filter(({ event }) => !isFlaggedFiling(event))
    .toSorted(
      (left, right) =>
        Math.abs(Date.parse(left.event.at) - asOfMs) - Math.abs(Date.parse(right.event.at) - asOfMs)
    )
    .slice(0, Math.max(limit - flagged.length, 0))

  return [...flagged, ...nearest].toSorted(
    (left, right) =>
      left.event.at.localeCompare(right.event.at) ||
      left.instrument.ticker.localeCompare(right.instrument.ticker)
  )
}
