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
  readonly unitPriceBase: number
  /** The same mark in the quoting market's own currency. An order line prints this one: the price
   *  a venue accepts is the one it quotes in. */
  readonly unitPrice: number
  readonly currency: CurrencyCode
  readonly boardLot: number
  readonly averageDailyTurnoverBase?: number
  /** Daily close-to-close volatility. Absent leaves the name unadjusted rather than penalized. */
  readonly volatilityDaily?: number
  readonly maximumPositionPctNav: number
  readonly caveats: readonly Caveat[]
}
