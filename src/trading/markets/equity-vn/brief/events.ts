import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { MarketEvent } from '@/trading/kernel/market/market-event'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { BriefContext } from '@/trading/markets/equity-vn/brief/context'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { isEventSubject } from '@/trading/kernel/market/market-event'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import { absent, omitted, ready } from '@/trading/markets/equity-vn/brief/sections'
import { buildPayloadRejectedCaveat, reportedCaveats } from '@/trading/markets/equity-vn/caveats'
import {
  EVENT_HORIZON_SESSIONS,
  VN_MARKET_REF,
  VN_SOURCE_CONCURRENCY,
} from '@/trading/markets/equity-vn/policy'

/** A failed target contributes its caveats without removing another target's events. */
interface EventTarget {
  readonly rows: readonly DatedEvent[]
  readonly available: boolean
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

interface DatedEvent {
  readonly instrument: InstrumentRef
  readonly event: MarketEvent
}

interface EventWindow {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

/** Read live across the bounded name set rather than warmed into a cache: the horizon is a handful
 *  of names and a fortnight, and a stale corporate calendar is worse than a slow one. Covers what
 *  the operator holds as well as what they watch — an ex-date on an unwatched position is exactly
 *  the gap-down that would otherwise read as a loss. */
export async function buildEvents(context: BriefContext): Promise<BriefSectionResult> {
  const subjects = context.calendarNames.names

  if (subjects.length === 0) {
    return omitted('events')
  }

  const window: EventWindow = {
    fromDay: context.request.asOf,
    toDay: context.calendar.addTradingDays(context.request.asOf, EVENT_HORIZON_SESSIONS),
  }
  const targets = await mapWithConcurrency(subjects, VN_SOURCE_CONCURRENCY, (instrument) =>
    fetchEvents(context, instrument, window)
  )
  const caveats = dedupeCaveats([
    ...context.calendarNames.caveats,
    ...targets.flatMap((target) => target.caveats),
  ])
  const provenance = dedupeProvenance(targets.flatMap((target) => target.provenance))
  const rows = sortEvents(dedupeEvents(targets.flatMap((target) => target.rows)))

  if (rows.length === 0) {
    // A quiet calendar is only observable when every target answered.
    return targets.every((target) => target.available)
      ? omitted('events')
      : absent('events', caveats)
  }

  return ready(
    'events',
    rows.slice(0, context.policy.maximumItemsPerSection).map(({ event, instrument }) => ({
      at: event.at,
      ticker: instrument.ticker,
      eventKind: event.kind,
      ...(event.cashPerShare === undefined ? {} : { cashPerShare: event.cashPerShare }),
      ...(event.paysOn === undefined ? {} : { paysOn: event.paysOn }),
      ...(event.shareRatio === undefined ? {} : { shareRatio: event.shareRatio }),
      ...(event.subscriptionPrice === undefined
        ? {}
        : { subscriptionPrice: event.subscriptionPrice }),
    })),
    { caveats, provenance }
  )
}

async function fetchEvents(
  context: BriefContext,
  instrument: InstrumentRef,
  window: EventWindow
): Promise<EventTarget> {
  const result = await context.deps.sources.resolve({
    kind: 'events',
    context: {
      market: VN_MARKET_REF,
      instrument,
      fromDay: window.fromDay,
      toDay: window.toDay,
    },
    signal: context.request.signal,
  })

  if (result.kind === 'unavailable') {
    return {
      rows: [],
      available: false,
      provenance: [],
      caveats: reportedCaveats(result.caveats, 'events'),
    }
  }

  const admitted = result.value.filter((event) => isEventSubject(event, instrument))
  const rejected = admitted.length < result.value.length

  return {
    rows: admitted
      .filter((event) => event.at >= window.fromDay && event.at <= window.toDay)
      .map((event) => ({ instrument, event })),
    available: true,
    provenance: result.provenance,
    caveats: rejected
      ? [...result.caveats, buildPayloadRejectedCaveat(result.provenance, 'events')]
      : result.caveats,
  }
}

/** Without a provider id the whole value is the identity: two genuinely distinct events on one day
 *  would otherwise collapse into one line. */
function dedupeEvents(rows: readonly DatedEvent[]): readonly DatedEvent[] {
  const seen = new Set<string>()

  return rows.filter((row) => {
    const subject = buildInstrumentKey(row.instrument)
    const key =
      row.event.providerEventId === undefined
        ? `${subject}|${row.event.at}|${row.event.kind}|${row.event.title}`
        : `${subject}|${row.event.providerEventId}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function sortEvents(rows: readonly DatedEvent[]): readonly DatedEvent[] {
  return [...rows].sort(
    (left, right) =>
      left.event.at.localeCompare(right.event.at) ||
      left.instrument.ticker.localeCompare(right.instrument.ticker)
  )
}
