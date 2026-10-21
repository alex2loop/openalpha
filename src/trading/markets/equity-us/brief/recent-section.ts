import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { MarketEvent, MarketEventKind } from '@/trading/kernel/market/market-data'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { BriefContext } from '@/trading/markets/brief-context'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { isEventSubject } from '@/trading/kernel/market/market-event'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import { absent, omitted, ready } from '@/trading/markets/brief-sections'
import { runUsEvents } from '@/trading/markets/equity-us/events'
import { US_SOURCE_CONCURRENCY } from '@/trading/markets/equity-us/policy'

/** Sessions back a filing still reads as news, and sessions ahead an ex-date is worth stating. */
const RECENT_FILING_SESSIONS = 5
const EX_DATE_HORIZON_SESSIONS = 10
const FILED_KINDS: readonly MarketEventKind[] = ['earnings-release', 'insider-purchase']

interface RecentTarget {
  readonly rows: readonly DatedEvent[]
  readonly available: boolean
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

interface DatedEvent {
  readonly instrument: InstrumentRef
  readonly event: MarketEvent
}

interface RecentWindow {
  readonly fromDay: TradingDay
  readonly asOf: TradingDay
  readonly toDay: TradingDay
}

/** What a name the operator holds or watches just filed, and the ex-dividend dates ahead. Read live
 *  over the bounded name set: a stale filing calendar is worse than a slow one. */
export async function buildRecent(context: BriefContext): Promise<BriefSectionResult> {
  const subjects = context.calendarNames.names

  if (subjects.length === 0) {
    return omitted('recent')
  }

  const { asOf } = context.request
  const window: RecentWindow = {
    fromDay: context.calendar.addTradingDays(asOf, -RECENT_FILING_SESSIONS),
    asOf,
    toDay: context.calendar.addTradingDays(asOf, EX_DATE_HORIZON_SESSIONS),
  }
  const targets = await mapWithConcurrency(subjects, US_SOURCE_CONCURRENCY, (instrument) =>
    readRecent(context, instrument, window)
  )
  const caveats = dedupeCaveats([
    ...context.calendarNames.caveats,
    ...targets.flatMap((target) => target.caveats),
  ])
  const rows = sortRecent(targets.flatMap((target) => target.rows))

  if (rows.length === 0) {
    // A quiet filing calendar is only observable when every target answered.
    return targets.every((target) => target.available)
      ? omitted('recent')
      : absent('recent', caveats)
  }

  return ready(
    'recent',
    rows.slice(0, context.policy.maximumItemsPerSection).map((row) => ({
      at: row.event.at,
      ticker: row.instrument.ticker,
      eventKind: row.event.kind,
    })),
    { caveats, provenance: dedupeProvenance(targets.flatMap((target) => target.provenance)) }
  )
}

async function readRecent(
  context: BriefContext,
  instrument: InstrumentRef,
  window: RecentWindow
): Promise<RecentTarget> {
  const result = await runUsEvents(context.deps, {
    instrument,
    fromDay: window.fromDay,
    asOf: window.toDay,
    now: context.request.now,
    signal: context.request.signal,
  })

  if (result.kind === 'unavailable') {
    // No calendar for a name no provider covers is an answer, not an outage.
    return {
      rows: [],
      available: result.reason === 'unsupported',
      provenance: [],
      caveats: result.reason === 'unsupported' ? [] : result.caveats,
    }
  }

  return {
    rows: result.value
      .filter((event) => isEventSubject(event, instrument) && isRecent(event, window))
      .map((event) => ({ instrument, event })),
    available: true,
    provenance: result.provenance,
    caveats: result.caveats,
  }
}

/** A filing already out and an ex-date still ahead; a past ex-date is not news. */
function isRecent(event: MarketEvent, window: RecentWindow): boolean {
  if (FILED_KINDS.includes(event.kind)) {
    return event.at >= window.fromDay && event.at <= window.asOf
  }

  return event.kind === 'dividend-ex-date' && event.at >= window.asOf && event.at <= window.toDay
}

function sortRecent(rows: readonly DatedEvent[]): readonly DatedEvent[] {
  return rows.toSorted(
    (left, right) =>
      left.event.at.localeCompare(right.event.at) ||
      left.instrument.ticker.localeCompare(right.instrument.ticker)
  )
}
