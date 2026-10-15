import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { InstrumentRecord, SessionQuote } from '@/trading/kernel/market/market-data'
import type { MarketIntradayBreadth } from '@/trading/kernel/market/market-overview'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketManifest } from '@/trading/markets/types'
import { sessionPhase } from '@/trading/markets/calendar'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'

interface IntradayBreadthLoad {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  /** The session the stored evidence already covers. A live count for that same day would restate
   *  the settled block from a second source. */
  readonly settled: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

interface IntradayBreadthRead {
  readonly breadth?: MarketIntradayBreadth
  readonly caveats: readonly Caveat[]
}

/** Absent because the board has not opened, because the session is the settled one, or because the
 *  read failed - the caveats are what separate the last from the first two. */
const NO_INTRADAY_READ: IntradayBreadthRead = Object.freeze({ caveats: [] })

/** What the board is doing in the session still running, counted from the live market-wide read.
 *  Only the three counts: a name at its ceiling at 13:09 need not close there, and a partial
 *  session divided by a full-session mean reads as a liquidity collapse every morning.
 *
 *  Best-effort - the overview stands whole without it. */
export async function vnIntradayBreadth(
  load: IntradayBreadthLoad,
  universe: readonly InstrumentRecord[]
): Promise<IntradayBreadthRead> {
  const { manifest, now } = load
  const day = manifest.calendar.dayAt(now)

  if (!hasOpened(load) || day === load.settled) {
    return NO_INTRADAY_READ
  }

  const result = await load.deps.sources.resolve({
    kind: 'sessionQuotes',
    context: { market: VN_MARKET_REF, toDay: day },
    signal: load.signal,
  })

  if (result.kind !== 'available') {
    return { caveats: result.caveats }
  }

  const breadth = toIntradayBreadth(result.value, universe, day)

  return breadth === undefined ? NO_INTRADAY_READ : { breadth, caveats: [] }
}

/** A live read only says something once the board has opened; the lunch break is still the same
 *  session, and the close is when the counts stop moving rather than when they stop mattering. */
function hasOpened(load: IntradayBreadthLoad): boolean {
  const phase = sessionPhase(load.manifest.calendar, load.now)

  return phase === 'open' || phase === 'break' || phase === 'post-close'
}

/** Counted over the same admitted universe the settled block measures, so the two denominators
 *  differ only by how much of the session has run. The feed lists every name the exchange carries,
 *  which is several hundred more, and two populations one above the other invite subtraction. */
function toIntradayBreadth(
  quotes: readonly SessionQuote[],
  universe: readonly InstrumentRecord[],
  day: TradingDay
): MarketIntradayBreadth | undefined {
  const admitted = new Set(
    universe.filter((record) => record.kind === 'equity').map((record) => record.instrument.ticker)
  )
  const traded = quotes.filter(
    (quote) =>
      quote.kind === 'equity' &&
      quote.at === day &&
      quote.matchedVolume > 0 &&
      admitted.has(quote.instrument.ticker)
  )

  if (traded.length === 0) {
    return undefined
  }

  return {
    at: day,
    advancers: traded.filter((quote) => quote.changePct > 0).length,
    decliners: traded.filter((quote) => quote.changePct < 0).length,
    matched: traded.length,
  }
}
