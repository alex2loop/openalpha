import type { DailyPriceBandPolicy } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'

/** Which limit a session sat pinned at. At the ceiling nobody sells; at the floor nobody buys. */
export type LimitLock = 'floor' | 'ceiling'

export interface MarketPriceLimit {
  lockOf(bar: Candle, previousClose: number, band: DailyPriceBandPolicy): LimitLock | undefined
}
