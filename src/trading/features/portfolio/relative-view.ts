import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, PortfolioSegment, TradingDay } from '@/trading/kernel/instrument'

/** Cash is one of the `segmentWeights` rows, never also a field of its own: two representations of
 *  the same weight are a double-count waiting for a consumer to sum them. */
export interface RelativePortfolioView {
  /** The ledger day this book was folded to. Not the session the prices came from — that is each
   *  position's own `markedOn`, and before today's close the two differ by a session. */
  readonly asOf: TradingDay
  readonly positions: readonly RelativePositionView[]
  readonly segmentWeights: readonly SegmentWeight[]
  readonly sectorWeights: readonly SectorWeight[]
  /** Newest first. */
  readonly closedPositions: readonly ClosedPositionView[]
  readonly caveats: readonly Caveat[]
}

export interface RelativePositionView {
  readonly instrument: InstrumentRef
  /** Share of NAV as a fraction: 0.583 is 58,3%. Every `*PctNav` in this module is a fraction. */
  readonly weightPctNav?: number
  readonly settledPctQuantity: number
  /** The session the weight and return above were marked at. Absent on an unpriced holding, which
   *  has no mark to date. */
  readonly markedOn?: TradingDay
  readonly caveats: readonly Caveat[]
}

interface SegmentWeight {
  readonly segment: PortfolioSegment
  /** Share of NAV as a fraction: 0.583 is 58,3%. Every `*PctNav` in this module is a fraction. */
  readonly weightPctNav?: number
}

interface SectorWeight {
  readonly sector: string
  /** Share of NAV as a fraction: 0.583 is 58,3%. Every `*PctNav` in this module is a fraction. */
  readonly weightPctNav?: number
}

/** A sold position as a model may know it: whether it made or lost money, never by how much. The
 *  figures reach the operator on `/portfolio` only. */
interface ClosedPositionView {
  readonly instrument: InstrumentRef
  readonly closedAt: TradingDay
  readonly result: 'gain' | 'loss'
}
