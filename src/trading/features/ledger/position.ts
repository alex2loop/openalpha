import type { CurrencyCode, InstrumentRef, TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { PositionBuy, PositionLot } from '@/trading/kernel/operator/book'

// Repeated partial sells accumulate float residue; dust must not survive as a phantom position.
// A fixed constant, not config — no operator-tunable knob makes sense for a float epsilon. Exported
// because reconciliation reads the same floor: a delta under it is this arithmetic, not a break.
export const QUANTITY_EPSILON = 1e-9

// How far a sale may sit above the position it closes and still *be* that position. An exchange
// rounds a full exit up to the instrument's lot while the book netted the buy's in-kind fee down,
// so the order that sold everything reads a hair above what the fold holds — 0.0012% on the widest
// observed. An order of magnitude below the smallest fee that could hide a real second trade, and
// five above float residue.
const CLOSING_OVERSHOOT_RATIO = 1e-4

interface MutableLot {
  readonly entryId: PositionLot['entryId']
  readonly acquiredAt: TradingDay
  readonly settledAt: TradingDay
  quantity: number
  remainingQuantity: number
}

export interface MutablePosition {
  readonly instrument: InstrumentRef
  readonly venue: VenueRef
  readonly currency: CurrencyCode
  quantity: number
  costBasisNative: number
  costBasisBase: number
  costBasisFeesNative: number
  costBasisFeesBase: number
  /** Units sold in the cycle currently open. Reset when a buy reopens the position from flat. */
  cycleSoldQuantity: number
  cycleBuys: PositionBuy[]
  readonly lots: MutableLot[]
}

/** Whether a sale takes the whole of `held`, the overshoot included: such a sale must release all
 *  of the basis rather than the fraction over one its own ratio would compute, and leave the fold no
 *  negative quantity to carry. Deliberately not symmetric — a sale *under* the position by more than
 *  float residue is a partial, and what to do with a sliver too small to sell is the surfaces'
 *  question, answered against the venue's own minimum rather than a ratio guessed here. */
export function isClosingSale(held: number, quantity: number): boolean {
  return quantity >= held - QUANTITY_EPSILON
}

/** How far a sale may exceed `held` and still be the one that closed it. A whole-unit holding (VN
 *  shares) had no in-kind fee netted from it, so it closes at exactly its own size. */
export function closingOvershootOf(held: number): number {
  if (Number.isInteger(held)) {
    return QUANTITY_EPSILON
  }

  return Math.max(QUANTITY_EPSILON, Math.abs(held) * CLOSING_OVERSHOOT_RATIO)
}

export function settledQuantityAt(position: MutablePosition, asOf: TradingDay): number {
  return position.lots.reduce(
    (sum, lot) => (lot.settledAt <= asOf ? sum + lot.remainingQuantity : sum),
    0
  )
}

/** Average cost: a sale removes the pro-rata share of remaining basis. Not FIFO, not LIFO — one
 *  auditable choice for a suggest-only book, stated once here. A closing sale releases all of it,
 *  rather than the fraction over one its overshoot would otherwise compute. */
export function sellShare(position: MutablePosition, quantity: number, closing: boolean): number {
  if (closing) {
    return 1
  }

  return position.quantity > QUANTITY_EPSILON ? quantity / position.quantity : 0
}

/** Snap a position the fold has emptied: a residual quantity a later sell's share would divide
 *  against, and a residual basis the next buy would average its own cost into. */
export function clearFlatPosition(position: MutablePosition): void {
  position.quantity = 0
  position.costBasisNative = 0
  position.costBasisBase = 0
  position.costBasisFeesNative = 0
  position.costBasisFeesBase = 0
}

/** FIFO consumption of open lot *quantities*. Lots exist to track settlement timing; cost basis is
 *  average-cost and lives only on the position — a per-lot cost would state a different (specific-
 *  lot) basis than the one the fold actually uses. */
export function consumeLots(position: MutablePosition, quantity: number): void {
  let outstanding = quantity

  for (const lot of position.lots) {
    if (outstanding <= QUANTITY_EPSILON) {
      return
    }

    const taken = Math.min(lot.remainingQuantity, outstanding)

    if (taken <= 0) {
      continue
    }

    lot.remainingQuantity -= taken
    outstanding -= taken
  }
}
