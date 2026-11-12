import type { InstrumentRef, VenueRef } from '@/trading/kernel/instrument'

/** How much of one position has an exit standing at it. A fraction of the position and never a
 *  quantity, because a unit count is book size an agent may not see — the same reason the portfolio
 *  has a relative view at all. */
export interface ExitCoverage {
  readonly instrument: InstrumentRef
  readonly venue: VenueRef
  /** 1 where the whole position is covered, 0 where nothing stands under it. */
  readonly guardedShare: number
  readonly takeProfit?: number
  readonly stopLoss?: number
}

/** A position at a venue with less exit standing at it than the book says is held. Both figures,
 *  because partly guarded and not guarded at all are different situations and the remedy names a
 *  size. Only ever a venue this tree can place at — nothing can rest at a hand-held custodian. */
export interface UnguardedPosition {
  readonly instrument: InstrumentRef
  readonly venue: VenueRef
  readonly quantity: number
  readonly guarded: number
}

/** An exit resting at a venue under this tree's client id shape that no live row names, so the exit
 *  tick cannot see it. */
export interface OrphanExit {
  readonly venue: VenueRef
  readonly symbol: string
  readonly exitId: string
  readonly quantity: number
  readonly takeProfit?: number
  readonly stopLoss?: number
}
