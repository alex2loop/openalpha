import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'

export const MARKET_EVENT_KINDS = Object.freeze([
  'dividend-ex-date',
  'agm',
  'meeting-ex-date',
  'split',
  'rights-issue',
  'additional-listing',
  'listing',
  'delisting',
  'last-trading-day',
  'margin-eligible',
  'margin-ineligible',
] as const)
export type MarketEventKind = (typeof MARKET_EVENT_KINDS)[number]

export interface MarketEvent {
  readonly at: TradingDay
  readonly kind: MarketEventKind
  readonly title: string
  readonly instrument?: InstrumentRef
  readonly detail?: string
  readonly providerEventId?: string
  /** A cash dividend's amount per share, in the market's price unit; absent where not published. */
  readonly cashPerShare?: number
  /** The day a cash dividend is paid; absent where not published. */
  readonly paysOn?: TradingDay
  /** New shares per share held, as a fraction (`0.1` for 100:10), for a share dividend, a bonus
   *  issue or a rights issue; absent where not published. */
  readonly shareRatio?: number
  /** What a rights issue's new share costs, in the market's price unit; absent where not published. */
  readonly subscriptionPrice?: number
}

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
