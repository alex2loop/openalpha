import type { Locale } from '@/core/types/locale'
import type { CurrencyCode, InstrumentRef, TradingDay } from '@/trading/kernel/instrument'

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
  'earnings-release',
  'insider-purchase',
] as const)
export type MarketEventKind = (typeof MARKET_EVENT_KINDS)[number]

/** How many days ahead a surface lists a name's dated events: far enough to plan around an ex-date,
 *  near enough that the list is about now. */
export const EVENTS_AHEAD_DAYS = 14

/** How far back a name's events read reaches. HOSE republishes the margin list quarterly, so two
 *  cycles reach a row that took effect at the start of the previous one. */
const EVENTS_LOOKBACK_SESSIONS = 130

/** The first day a name's events read reaches back to: the one owner of the window, so a reader of
 *  past events can tell what the read could not have covered. */
export function eventsFromDay(
  calendar: { addTradingDays(day: TradingDay, count: number): TradingDay },
  asOf: TradingDay
): TradingDay {
  return calendar.addTradingDays(asOf, -EVENTS_LOOKBACK_SESSIONS)
}

export type InsiderRelationship = 'director' | 'ten-percent-owner'

/** What an insider bought, kept as facts so a reader words it in its own language. */
export interface InsiderPurchase {
  readonly owner: string
  /** The officer title as the filing writes it; absent for a director or a large holder. */
  readonly officerTitle?: string
  readonly relationship?: InsiderRelationship
  readonly shares: number
  /** Per share, in `currency`; absent when the filing states it only in a footnote. */
  readonly price?: number
  readonly currency: CurrencyCode
}

export interface MarketEvent {
  readonly at: TradingDay
  readonly kind: MarketEventKind
  /** The provider's own words, or English the adapter wrote itself where `composedText` is set. */
  readonly title: string
  readonly instrument?: InstrumentRef
  readonly detail?: string
  /** `title` and `detail` are the adapter's English, for a model and the logs: a reader showing the
   *  event to a person words it from the kind and the facts below, in the person's language. */
  readonly composedText?: true
  /** The language the provider writes `title` and `detail` in, so a reader of the other language is
   *  told; set by the adapter from its own source, absent on text it composed. */
  readonly writtenIn?: Locale
  readonly insider?: InsiderPurchase
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
