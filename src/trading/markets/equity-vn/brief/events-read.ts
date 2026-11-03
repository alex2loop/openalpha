import type { InstrumentRef } from '@/trading/kernel/instrument'
import type {
  EventsRead,
  EventsReadInput,
  EventTarget,
  EventWindow,
} from '@/trading/markets/brief-events'
import { isEventSubject } from '@/trading/kernel/market/market-event'
import { collectEvents } from '@/trading/markets/brief-events'
import { buildPayloadRejectedCaveat, reportedCaveats } from '@/trading/markets/equity-vn/caveats'
import {
  EVENT_HORIZON_SESSIONS,
  VN_MARKET_REF,
  VN_SOURCE_CONCURRENCY,
} from '@/trading/markets/equity-vn/policy'

/** The coming fortnight of held and watched names: an ex-date on an unwatched position is exactly
 *  the gap-down that would otherwise read as a loss. */
export function readVnEvents(input: EventsReadInput): Promise<EventsRead> {
  const window: EventWindow = {
    fromDay: input.request.asOf,
    toDay: input.calendar.addTradingDays(input.request.asOf, EVENT_HORIZON_SESSIONS),
  }

  return collectEvents(input, {
    concurrency: VN_SOURCE_CONCURRENCY,
    read: (instrument) => fetchEvents(input, instrument, window),
  })
}

async function fetchEvents(
  input: Pick<EventsReadInput, 'deps' | 'request'>,
  instrument: InstrumentRef,
  window: EventWindow
): Promise<EventTarget> {
  const result = await input.deps.sources.resolve({
    kind: 'events',
    context: {
      market: VN_MARKET_REF,
      instrument,
      fromDay: window.fromDay,
      toDay: window.toDay,
    },
    signal: input.request.signal,
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
