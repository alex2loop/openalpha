import type { MarketRange } from '@/trading/kernel/market/market-overview'

/** An overview's leader lists cover the one session it reports, never a trailing window: its
 *  market-wide totals are that session's, and a list summing more would contradict them. */
export const OVERVIEW_LEADER_SESSIONS = 1

/** A month of sessions: fewer cannot place a swing, and a two-bar window reports its own two prices
 *  as support and resistance, which reads as a market pinned at one level. */
const RANGE_MINIMUM_SESSIONS = 20

/** `buildPriceRange`'s support and resistance plus the fraction distances a stop is sized from,
 *  measured from `from` where the market is quoting one and from the last close otherwise: a
 *  distance is only useful from the price it would be acted on at. Either distance goes negative
 *  once the quote leaves the settled swing, which is the breakout stated plainly rather than hidden.
 *  Undefined when the window is too short to place a swing, or the price is not positive. */
export function rangeFromCloses(closes: readonly number[], from?: number): MarketRange | undefined {
  if (closes.length < RANGE_MINIMUM_SESSIONS) {
    return undefined
  }

  const range = buildPriceRange(closes)
  const price = from ?? range?.last

  if (range === undefined || price === undefined || price <= 0) {
    return undefined
  }

  return {
    sessions: closes.length,
    support: range.support,
    resistance: range.resistance,
    supportPct: (price - range.support) / price,
    resistancePct: (range.resistance - price) / price,
  }
}

interface PriceRange {
  readonly support: number
  readonly resistance: number
  readonly last: number
}

function buildPriceRange(closes: readonly number[]): PriceRange | undefined {
  const usable = closes.filter((close) => Number.isFinite(close) && close > 0)
  const last = usable[usable.length - 1]

  if (last === undefined) {
    return undefined
  }

  return { support: Math.min(...usable), resistance: Math.max(...usable), last }
}

/** The same-day round-trip cost on a two-sided board: (sell - buy) / sell. Undefined when either side
 *  is absent, so a one-sided quote never reports a spread it does not have. */
export function spreadPct(buy: number | undefined, sell: number | undefined): number | undefined {
  if (buy === undefined || sell === undefined || sell <= 0) {
    return undefined
  }

  return (sell - buy) / sell
}
