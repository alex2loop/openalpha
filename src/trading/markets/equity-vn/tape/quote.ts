import type { TradingDay } from '@/trading/kernel/instrument'
import type {
  InstrumentRequest,
  PreviousClose,
  QuoteRequest,
} from '@/trading/kernel/market/market-capability'
import type { Quote } from '@/trading/kernel/market/market-data'
import type { LiveIndexReading } from '@/trading/kernel/market/market-overview'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketManifest, TradingCalendar } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import {
  isLiveObservation,
  isSettled,
  resolveSettledDay,
  sessionPhase,
} from '@/trading/markets/calendar'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { seriesClass } from '@/trading/markets/equity-vn/refresh/bars'
import { toLiveReading } from '@/trading/markets/live-reading'
import { type AvailableQuote, storedQuote, withNotLive } from '@/trading/markets/stored-quote'
import { changeAgainstClose } from '@/trading/sources/rows/normalization'

/** The session decides which reading a caller gets, because no caller has anything better to decide
 *  it with: while trading is under way the provider is asked for the intraday price, and outside it
 *  the stored series answers, so a price costs no request and every reader of one run sees the same
 *  number. A live read that fails falls back to the settled close rather than leaving the caller
 *  unpriced — a book values on whatever mark it can get, and only the freshness stamp may go
 *  missing.
 *
 *  A read that *succeeds* without being fresher than that close falls back the same way. A broker
 *  board answers a halted ticker with its last print indefinitely, and a session that has settled
 *  answers every later request with the close it already holds; both arrive well-formed, so nothing
 *  below this can tell them from a price the market is making now. */
export async function vnQuote(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: QuoteRequest
): Promise<SourceResult<Quote>> {
  if (canReadLive(manifest.calendar, request.now)) {
    const live = await sourceQuote(deps, manifest, request)

    const fresh = liveQuoteOf(live, manifest.calendar, request.now)

    if (fresh !== undefined) {
      return withSessionStart(fresh, manifest.calendar)
    }

    const stored = await storedQuote(deps, manifest.calendar, request)

    if (stored === undefined) {
      return live
    }

    // Only where a reading arrived and was refused. A read that failed carries its own caveats, and
    // an absent close is not a claim about this name's tape.
    return live.kind === 'available' ? withNotLive(stored, request.instrument.ticker) : stored
  }

  const stored = await storedQuote(deps, manifest.calendar, request)

  return stored ?? sourceQuote(deps, manifest, request)
}

/** Whether a reading fresher than the settled close can still exist: trading has opened and today's
 *  tape has not settled. Past that the provider has only the close the store already holds, so
 *  asking spends a request per name per alert tick to be refused every time. */
function canReadLive(calendar: TradingCalendar, now: number): boolean {
  return isAfterOpen(calendar, now) && !isSettled(calendar, calendar.dayAt(now), now)
}

/** The reading, only where its own session is newer than the settled close — judged by that session
 *  and never by the instant, because a closing auction prints minutes after the bell and an instant
 *  test reads that close as a live price for the rest of the day. Returns the quote rather than a
 *  boolean: a predicate would tell the compiler its false branch is an unavailable result, when it
 *  is just as often an available one that is stale. */
function liveQuoteOf(
  quote: SourceResult<Quote>,
  calendar: TradingCalendar,
  now: number
): AvailableQuote | undefined {
  if (quote.kind !== 'available' || !isLiveObservation(calendar, quote.value.observedAt, now)) {
    return undefined
  }

  return isWithinSession(quote.value) ? quote : undefined
}

/** A price outside the range the same read reports for its own session contradicts itself, and
 *  nothing below can tell which half is wrong. Refused for the stored close, the same fallback a
 *  board that has not printed takes. */
function isWithinSession(quote: Quote): boolean {
  const { session } = quote

  return session === undefined || (quote.price >= session.low && quote.price <= session.high)
}

/** A source that publishes the session's high, low and volume without saying when the session began
 *  leaves the start to the market: the calendar is the only owner of when trading opened, and a
 *  range with no start reads as a range over an unknown window. */
function withSessionStart(quote: AvailableQuote, calendar: TradingCalendar): SourceResult<Quote> {
  const { session } = quote.value

  if (session === undefined || session.fromAt !== undefined) {
    return quote
  }

  return {
    ...quote,
    value: {
      ...quote.value,
      session: {
        ...session,
        fromAt: calendar.sessionOpenAt(calendar.dayAt(quote.value.observedAt)),
      },
    },
  }
}

/** The settled session's close a live reading must beat to count as news. */
interface LiveIndexRequest extends InstrumentRequest {
  readonly settledDay: TradingDay
}

/** Where the index trades now, beside the settled close its row reports. Absent unless the session
 *  has opened and the reading is genuinely fresher than that close, so a closed market never
 *  restates the close as current. Best-effort: the overview stands whole without it. */
export async function vnLiveIndexReading(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: LiveIndexRequest
): Promise<LiveIndexReading | undefined> {
  if (!isAfterOpen(manifest.calendar, request.now)) {
    return undefined
  }

  try {
    const quote = await sourceQuote(deps, manifest, request)

    return toLiveReading(quote, manifest.calendar, {
      settledDay: request.settledDay,
      now: request.now,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    // Decoration only: a throwing provider must not take the overview down with it.
    return undefined
  }
}

/** Which session an index row states, and whether the reading beside it is still current. The VN
 *  index endpoint withholds a settled session's daily bar until it settles overnight, so for the
 *  rest of the evening the stored series is one session behind and the reading is the only place
 *  that session's close exists — stating it as live dates a close to a clock. Judged against
 *  `resolveSettledDay`, never against the newest stored bar, which is the store's state and not the
 *  tape's. */
interface HeadlineLevel {
  readonly close: PreviousClose
  readonly live?: LiveIndexReading
}

export function headlineLevel(
  stored: PreviousClose,
  reading: LiveIndexReading | undefined,
  source: { readonly calendar: TradingCalendar; readonly now: number }
): HeadlineLevel {
  if (reading === undefined) {
    return { close: stored }
  }

  if (reading.observedOn > resolveSettledDay(source.calendar, source.now)) {
    return { close: stored, live: reading }
  }

  const changePct = changeAgainstClose(reading.price, stored.price, reading.changePct)

  return {
    close: {
      price: reading.price,
      at: reading.observedOn,
      ...(changePct === undefined ? {} : { changePct }),
    },
  }
}

/** A live request still buys this morning's price during the lunch break, which is why this asks
 *  the phase rather than `sessionState`. */
function isAfterOpen(calendar: TradingCalendar, now: number): boolean {
  const phase = sessionPhase(calendar, now)

  return phase === 'open' || phase === 'break' || phase === 'post-close'
}

async function sourceQuote(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: QuoteRequest
): Promise<SourceResult<Quote>> {
  return deps.sources.resolve({
    kind: 'quote',
    context: {
      market: VN_MARKET_REF,
      instrument: request.instrument,
      toDay: request.asOf,
      // The one place the intraday resolution is chosen, from the only fact that can choose it: a
      // series that exists to be read while trading is under way, and nowhere else.
      live: isAfterOpen(manifest.calendar, request.now),
      ...(await seriesClass(deps, request)),
    },
    signal: request.signal,
  })
}
