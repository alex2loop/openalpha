// The /v1 index contract: what moved a market's index this session and how it is valued. Same rules
// as `wire/market.ts`; percent fields are percents, as on `/v1/quotes`.

import type { InstrumentRefWire, TradingWireCaveat } from '@/app/server/wire/trading'

/** One name's share of the index's move this session. */
interface IndexContributorWire {
  readonly instrument: InstrumentRefWire
  /** Index points; negative weighed on the index. */
  readonly point: number
  /** The board price in the market's currency, whole. */
  readonly price: number
}

/** GET /v1/index-contributors?market&index — each side strongest first; no `contributors` when
 *  the read failed and the daemon holds no earlier list, and `caveats` says why. */
export interface IndexContributorsResponse {
  readonly market: string
  readonly index: string
  readonly contributors?: {
    /** The session the list describes. */
    readonly asOf: string
    readonly up: readonly IndexContributorWire[]
    readonly down: readonly IndexContributorWire[]
    /** What the listed names added up to, in index points; not the index's whole move. */
    readonly upSum: number
    readonly downSum: number
  }
  readonly caveats: readonly TradingWireCaveat[]
}

/** GET /v1/index-valuation?market&index — the ratios the last refresh stored; no `valuation` until
 *  one has. */
export interface IndexValuationResponse {
  readonly market: string
  readonly index: string
  readonly valuation?: {
    /** The day the ratios are of. */
    readonly asOf: string
    readonly pe: number
    readonly pb: number
    /** Derived, `pb / pe`: the provider publishes no ROE for an index. */
    readonly roePct: number
    readonly dividendYieldPct?: number
    /** The provider's own five-year averages of the two multiples. */
    readonly peAvg5y?: number
    readonly pbAvg5y?: number
    /** Share of the index's names above their own 50- and 200-session mean. */
    readonly aboveMa50Pct?: number
    readonly aboveMa200Pct?: number
  }
  readonly caveats: readonly TradingWireCaveat[]
}
