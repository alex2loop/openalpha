import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { SourceStamp } from '@/trading/kernel/market/market-data'

/** One name's ratios on one session. The provider publishes no P/E for a loss-making year, so an
 *  absent ratio is no reading, never zero. */
export interface ValuationPoint {
  readonly ticker: Ticker
  readonly day: TradingDay
  readonly priceToEarnings?: number
  readonly priceToBook?: number
  /** The provider's own five-year averages, read on the market-wide day only. */
  readonly averagePriceToEarnings5y?: number
  readonly averagePriceToBook5y?: number
}

export interface ValuationRatios extends SourceStamp {
  /** Oldest first, then by ticker. */
  readonly points: readonly ValuationPoint[]
}
