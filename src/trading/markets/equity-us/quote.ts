import type { QuoteRequest } from '@/trading/kernel/market/market-capability'
import type { Quote } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketManifest, TradingCalendar } from '@/trading/markets/types'
import { isLiveObservation, isSettled, sessionPhase } from '@/trading/markets/calendar'
import { instrumentKindOf } from '@/trading/markets/equity-us/bars'
import { US_MARKET_REF } from '@/trading/markets/equity-us/policy'
import { type AvailableQuote, storedQuote, withNotLive } from '@/trading/markets/stored-quote'

/** The session decides which reading a caller gets: while trading is under way the provider is
 *  asked for the price, and outside it the stored series answers, so a price costs no request and
 *  every reader of one run sees the same number. A live read that fails, or arrives no fresher than
 *  the settled close, falls back to that close rather than leaving the caller unpriced. */
export async function runUsQuote(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: QuoteRequest
): Promise<SourceResult<Quote>> {
  const { calendar } = manifest

  if (!canReadLive(calendar, request.now)) {
    return (await storedQuote(deps, calendar, request)) ?? sourceQuote(deps, request)
  }

  const live = await sourceQuote(deps, request)
  const fresh = freshQuoteOf(live, calendar, request.now)

  if (fresh !== undefined) {
    return fresh
  }

  const stored = await storedQuote(deps, calendar, request)

  if (stored === undefined) {
    return live
  }

  // Only where a reading arrived and was refused: a failed read carries its own caveats.
  return live.kind === 'available' ? withNotLive(stored, request.instrument.ticker) : stored
}

/** Whether a reading fresher than the settled close can still exist: the session has opened and
 *  today's tape has not settled. */
function canReadLive(calendar: TradingCalendar, now: number): boolean {
  const phase = sessionPhase(calendar, now)

  return (
    (phase === 'open' || phase === 'post-close') && !isSettled(calendar, calendar.dayAt(now), now)
  )
}

/** The reading, only where its own session is newer than the settled close. */
function freshQuoteOf(
  quote: SourceResult<Quote>,
  calendar: TradingCalendar,
  now: number
): AvailableQuote | undefined {
  return quote.kind === 'available' && isLiveObservation(calendar, quote.value.observedAt, now)
    ? quote
    : undefined
}

async function sourceQuote(deps: MarketDeps, request: QuoteRequest): Promise<SourceResult<Quote>> {
  return deps.sources.resolve({
    kind: 'quote',
    context: {
      market: US_MARKET_REF,
      instrument: request.instrument,
      toDay: request.asOf,
      live: true,
      ...(await instrumentKindOf(deps, request)),
    },
    signal: request.signal,
  })
}
