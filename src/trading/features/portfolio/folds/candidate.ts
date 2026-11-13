import type { Caveat } from '@/trading/kernel/caveat'
import type {
  CurrencyCode,
  InstrumentKind,
  InstrumentRef,
  PortfolioSegment,
} from '@/trading/kernel/instrument'

/** Assembled by `PortfolioService`; markets expose no sizing method, so assembly has one owner. */
export interface PortfolioCandidate {
  readonly instrument: InstrumentRef
  readonly segment: PortfolioSegment
  readonly marketScore: number
  readonly sector?: string
  readonly instrumentKind?: InstrumentKind
  /** What a buy pays, in the book's base currency. */
  readonly unitPriceBase: number
  /** The same mark in the quoting market's own currency. An order line prints this one: the price
   *  a venue accepts is the one it quotes in. */
  readonly unitPrice: number
  /** What a sale gets, in the two currencies above. It parts from the buy price only on a dealer
   *  board, where the shop's buy price is below its sell price; a held name carries the book's own
   *  valuation mark. */
  readonly exitPriceBase: number
  readonly exitPrice: number
  readonly currency: CurrencyCode
  readonly boardLot: number
  readonly averageDailyTurnoverBase?: number
  /** Daily close-to-close volatility. Absent leaves the name unadjusted rather than penalized. */
  readonly volatilityDaily?: number
  readonly maximumPositionPctNav: number
  readonly caveats: readonly Caveat[]
}
