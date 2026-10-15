import type { TradingDay } from '@/trading/kernel/instrument'
import type { SourceStamp } from '@/trading/kernel/market/market-data'

/** The raw materials whose price sets a VN listed sector's margins. Each id is a market-less
 *  ticker, so a request names one through `SourceContext.ticker`. */
export const COMMODITY_IDS = Object.freeze([
  'BRENT',
  'NATURAL-GAS',
  'IRON-ORE',
  'COPPER',
  'ALUMINIUM',
  'RUBBER',
  'SUGAR',
  'COFFEE',
  'COAL',
  'RICE',
  'PORK',
  'STEEL',
] as const)
export type CommodityId = (typeof COMMODITY_IDS)[number]

export interface CommodityPoint {
  readonly day: TradingDay
  readonly close: number
}

/** Oldest first. Daily from an exchange feed, monthly from a statistics series, so a reader
 *  compares points by date, never by count. */
export interface CommodityHistory extends SourceStamp {
  readonly commodity: CommodityId
  readonly points: readonly CommodityPoint[]
}

export function toCommodityId(raw: string | undefined): CommodityId | undefined {
  return COMMODITY_IDS.find((id) => id === raw)
}
