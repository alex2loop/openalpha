import type { MarketDataScreenRequest } from '@/trading/features/market-data/types'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { ScreenCandidate } from '@/trading/kernel/market/market-capability'
import type { Quote } from '@/trading/kernel/market/market-data'
import type { Market, TradingCalendar } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { freshnessOf } from '@/trading/features/market-data/reads/freshness'
import { resolveDay } from '@/trading/features/market-data/resolve'
import { closedCandidate, pricedCandidate } from '@/trading/features/market-data/screen-caution'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const SCREEN_QUOTE_CONCURRENCY = 4

type ScreenPriceRequest = Pick<MarketDataScreenRequest, 'form' | 'now' | 'signal'>

/** The board's rank is settled by design, and the price says what the name costs now. A market
 *  still trading answers with a live quote; one that has closed answers with the close the rank
 *  was built on, labelled as such — dropping it there left a board with no price for every hour
 *  outside the session, which for a VN board is most of the day. Best-effort per name: a name
 *  whose quote fails keeps its rank-only row, and so carries no caution either. A market that swept
 *  the universe already answered; where it did not, the per-name fetch is bounded by the board a
 *  surface can show, past which the request is a bulk score read rather than a board. A whole
 *  board (`form: 'board'`) never asks per name: a page that browses every name would spend one
 *  live request each against a rate limit, so a name the sweep did not price reads at the settled
 *  close the market carried. */
export async function withPrices(
  market: Market,
  candidates: readonly ScreenCandidate[],
  options: ScreenPriceRequest
): Promise<readonly ScreenCandidate[]> {
  if (candidates.length === 0) {
    return candidates
  }

  const calendar = market.manifest.calendar
  const scope: QuoteScope = {
    quote: market.capabilities.quote,
    calendar,
    timezone: calendar.timezone,
    asOf: resolveDay(market, options.now),
    now: options.now,
    signal: options.signal,
  }
  const isBoard = isBoardForm(options)
  const fetchMissing = !isBoard && candidates.length <= SURFACE_LIMITS.maximumScreenCandidates

  return mapWithConcurrency(candidates, SCREEN_QUOTE_CONCURRENCY, async (candidate) => {
    const quote =
      candidate.liveQuote ??
      (fetchMissing ? await quotedValue(scope, candidate.instrument) : undefined)

    if (quote !== undefined) {
      return pricedCandidate(candidate, quote, freshnessOf(scope, quote.observedAt, options.now))
    }

    return isBoard ? closedCandidate(candidate, scope.calendar) : candidate
  })
}

export function isBoardForm(options: Pick<MarketDataScreenRequest, 'form'>): boolean {
  return options.form === 'board'
}

interface QuoteScope {
  readonly quote: Market['capabilities']['quote']
  readonly calendar: TradingCalendar
  readonly timezone: string
  readonly asOf: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

/** Decorative: a market that cannot answer, or throws answering, leaves the ranked board standing
 *  with the settled close it was built on. */
async function quotedValue(
  scope: QuoteScope,
  instrument: InstrumentRef
): Promise<Quote | undefined> {
  if (scope.quote === undefined) {
    return undefined
  }

  try {
    const result = await scope.quote.run({
      instrument,
      asOf: scope.asOf,
      now: scope.now,
      signal: scope.signal,
    })

    return result.kind === 'available' ? result.value : undefined
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    // The overlay must not take the board down with it. A cancel still unwinds: swallowing one
    // would fan through every remaining candidate and hand back a board nobody asked for.
    return undefined
  }
}
