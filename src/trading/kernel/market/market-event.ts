import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { MarketEvent } from '@/trading/kernel/market/market-data'

/** A provider answering a per-instrument request names no subject, so an absent one is the
 *  instrument asked for; a different one is a provider mismatch, dropped rather than filed under
 *  the wrong ticker. One owner, because a consumer that read the absence the other way silently
 *  discards every row this provider publishes. */
export function isEventSubject(event: MarketEvent, instrument: InstrumentRef): boolean {
  if (event.instrument === undefined) {
    return true
  }

  return (
    event.instrument.market === instrument.market && event.instrument.ticker === instrument.ticker
  )
}

/** A last trading day or a delisting: past it there is no position to open. */
export function isTradingEnd(event: MarketEvent): boolean {
  return event.kind === 'last-trading-day' || event.kind === 'delisting'
}
