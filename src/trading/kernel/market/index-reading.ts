import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { SourceStamp } from '@/trading/kernel/market/market-data'

/** The indexes the provider breaks down: VN-Index, the VN30 basket and the HNX board index. */
export const INDEX_CODES = Object.freeze(['VNINDEX', 'VN30', 'HNX'] as const)
export type IndexCode = (typeof INDEX_CODES)[number]

export function isIndexCode(value: string): value is IndexCode {
  return INDEX_CODES.some((code) => code === value)
}

/** One name's share of the index's move this session, in index points. The price is the board
 *  price in the market's currency, whole. */
export interface IndexContribution {
  readonly ticker: Ticker
  readonly point: number
  readonly price: number
}

/** Every name the index counted this session that moved it by more than rounding. */
export interface IndexContributions extends SourceStamp {
  readonly index: IndexCode
  readonly rows: readonly IndexContribution[]
}

/** The names that lifted and the names that weighed, each strongest first, with what each side
 *  added up to. A sum is the listed names' own, not the index's whole move. */
export interface IndexContributorsReading {
  readonly index: IndexCode
  readonly asOf: TradingDay
  readonly up: readonly IndexContribution[]
  readonly down: readonly IndexContribution[]
  readonly upSum: number
  readonly downSum: number
}

export const INDEX_RATIO_IDS = Object.freeze([
  'priceToEarnings',
  'priceToBook',
  'dividendYield',
  'averagePriceToEarnings5y',
  'averagePriceToBook5y',
  'aboveMa50Ratio',
  'aboveMa200Ratio',
] as const)
export type IndexRatioId = (typeof INDEX_RATIO_IDS)[number]

/** One day of an index's ratios as the provider prints them: multiples as multiples, the rest as
 *  fractions. A ratio the provider omits for the index is absent, never zero. */
export interface IndexRatios extends SourceStamp {
  readonly index: IndexCode
  readonly day: TradingDay
  readonly ratios: Readonly<Partial<Record<IndexRatioId, number>>>
}

/** What the stored ratios say about the index. `returnOnEquity` is derived, price-to-book over
 *  price-to-earnings: the provider publishes no ROE for an index. */
export interface IndexValuationReading {
  readonly index: IndexCode
  readonly asOf: TradingDay
  readonly priceToEarnings: number
  readonly priceToBook: number
  readonly returnOnEquity: number
  readonly dividendYield?: number
  readonly averagePriceToEarnings5y?: number
  readonly averagePriceToBook5y?: number
  /** Share of the index's names above their own mean, as a fraction. */
  readonly aboveMa50Ratio?: number
  readonly aboveMa200Ratio?: number
}

/** The stored series of one ratio of one index: one point a day, so the daemon keeps its own
 *  history of the valuation. */
export function indexRatioSeriesId(index: IndexCode, ratio: IndexRatioId): string {
  return `index-ratio:${index}:${ratio}`
}
