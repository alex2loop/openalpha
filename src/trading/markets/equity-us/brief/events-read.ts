import type { InstrumentRef } from '@/trading/kernel/instrument'
import type {
  EventsRead,
  EventsReadInput,
  EventTarget,
  EventWindow,
} from '@/trading/markets/brief-events'
import { isEventSubject } from '@/trading/kernel/market/market-event'
import { collectEvents } from '@/trading/markets/brief-events'
import { runUsEvents } from '@/trading/markets/equity-us/events'
import {
  US_EX_DATE_HORIZON_SESSIONS,
  US_RECENT_FILING_SESSIONS,
  US_SOURCE_CONCURRENCY,
} from '@/trading/markets/equity-us/policy'

/** The last week's filings and the coming fortnight's ex-dates of held and watched names: what the
 *  recent list prints and what next-actions reminds from. */
export function readUsEvents(input: EventsReadInput): Promise<EventsRead> {
  const { asOf } = input.request
  const window: EventWindow = {
    fromDay: input.calendar.addTradingDays(asOf, -US_RECENT_FILING_SESSIONS),
    toDay: input.calendar.addTradingDays(asOf, US_EX_DATE_HORIZON_SESSIONS),
  }

  return collectEvents(input, {
    concurrency: US_SOURCE_CONCURRENCY,
    read: (instrument) => readName(input, instrument, window),
  })
}

async function readName(
  input: Pick<EventsReadInput, 'deps' | 'request'>,
  instrument: InstrumentRef,
  window: EventWindow
): Promise<EventTarget> {
  const result = await runUsEvents(input.deps, {
    instrument,
    fromDay: window.fromDay,
    asOf: window.toDay,
    now: input.request.now,
    signal: input.request.signal,
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
      .filter(
        (event) =>
          isEventSubject(event, instrument) &&
          event.at >= window.fromDay &&
          event.at <= window.toDay
      )
      .map((event) => ({ instrument, event })),
    available: true,
    provenance: result.provenance,
    caveats: result.caveats,
  }
}
