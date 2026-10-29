// How one row's step is sized, clamped, and rounded — the vocabulary both sides of a plan speak.
// It lives apart from either side because a reduction and an increase share the arithmetic and
// nothing else: the sell side clamps on settled quantity, the buy side on a segment's cash budget.

import type { AdviceInput } from '@/trading/features/portfolio/folds/advice-input'
import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
import type { CapTrim } from '@/trading/features/portfolio/folds/policy'
import type { ChangeReason, OrderSize, PositionChange } from '@/trading/features/portfolio/types'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import { ROTATION_STEP_FRACTION } from '@/trading/features/portfolio/folds/policy'
import { floorToLot, roundToStep, STEP_DIGITS } from '@/trading/kernel/instrument'

/** How far a segment's names sit from their desired weights, each way. */
export interface SegmentGap {
  readonly excess: number
  readonly shortfall: number
}

/** Everything a row decision reads, assembled once per plan so neither side re-derives a weight. */
export interface RowInput {
  readonly input: AdviceInput
  readonly nav: number
  readonly desired: ReadonlyMap<string, number>
  readonly current: ReadonlyMap<string, number>
  readonly drifting: ReadonlyMap<PortfolioSegment, number>
  readonly candidates: ReadonlyMap<string, PortfolioCandidate>
  readonly segments: ReadonlyMap<PortfolioSegment, SegmentGap>
  /** A buy into one of these fills the segment's core, not a score. */
  readonly cores: ReadonlySet<string>
  readonly capTrims: ReadonlyMap<string, CapTrim>
  readonly excluded: ReadonlySet<string>
}

/** A paced step under the minimum never trades, and one that steps below it on every run abandons
 *  the rotation halfway. Take the smallest step that does trade, never past the gap. */
export function tradeable(step: number, gap: number, minimum: number): number {
  return Math.min(gap, Math.max(step, minimum))
}

/** The policy minimum raised to a whole lot. `roundToLot` floors, so a step clamped to the bare
 *  minimum lands just under it and the row is dropped — comparing both against a lot multiple is
 *  what makes the clamp survive its own rounding, and the lot quantity is settled and converted
 *  back exactly as `roundToLot` does. Which of the two binds is the market's: a VN board lot
 *  already exceeds the policy minimum, while crypto's lot is a precision step far under it, so no
 *  caveat over this number may name the lot as the reason. */
export function minimumStep(
  rows: RowInput,
  sizing: { readonly boardLot: number; readonly unitPriceBase: number }
): number {
  const minimum = rows.input.rebalancePolicy.minimumChangePctNav

  if (sizing.unitPriceBase <= 0 || sizing.boardLot <= 0) {
    return minimum
  }

  const quantity = roundToStep((minimum * rows.nav) / sizing.unitPriceBase, sizing.boardLot, 'up')

  return (quantity * sizing.unitPriceBase) / rows.nav
}

/** A move is two things: the segment closing its gap to target, taken in full because it is why the
 *  plan trades, and a preference among the names inside it. The second is a rotation, and
 *  suggestions accumulate, so it arrives a step per run. */
export function pacedStep(gap: number, segmentGap: number, segmentTotal: number): number {
  const prompt = segmentTotal > 0 ? gap * Math.min(1, segmentGap / segmentTotal) : 0

  return prompt + (gap - prompt) * ROTATION_STEP_FRACTION
}

// Rounds down to the board lot and converts back, so the percentage shown is one an order fills.
export function roundToLot(
  changePctNav: number,
  sizing: { readonly boardLot: number; readonly unitPriceBase: number },
  nav: number
): number {
  if (changePctNav <= 0 || sizing.unitPriceBase <= 0 || sizing.boardLot <= 0) {
    return 0
  }

  const floored = floorToLot((changePctNav * nav) / sizing.unitPriceBase, sizing.boardLot)
  const next = Number(
    ((Math.round(floored / sizing.boardLot) + 1) * sizing.boardLot).toFixed(STEP_DIGITS)
  )
  // Past ~1e8 lots a double cannot settle the division to a whole number, so the floor can land
  // one lot short of a step that converts back to exactly this weight.
  const quantity = (next * sizing.unitPriceBase) / nav <= changePctNav ? next : floored

  return (quantity * sizing.unitPriceBase) / nav
}

/** Divides by the same price the row was lot-rounded against, so the count is one an order fills.
 *  That holds because a held name's candidate carries the book's own valuation price: `pricedValue`
 *  returns it verbatim for a name the valuation already priced. A candidate that preferred a live
 *  quote for a held name would part the quantity from the rounding without either side saying so. */
export function sizeOf(
  change: PositionChange,
  candidate: PortfolioCandidate,
  nav: number
): OrderSize {
  const valueBase = Math.abs(change.changePctNav) * nav

  return {
    valueBase,
    quantity: valueBase / candidate.unitPriceBase,
    boardLot: candidate.boardLot,
    unitPriceBase: candidate.unitPriceBase,
    unitPrice: candidate.unitPrice,
    currency: candidate.currency,
  }
}

interface ChangeInput {
  readonly candidate: PortfolioCandidate
  readonly currentPctNav: number
  readonly targetPctNav: number
  readonly reason: ChangeReason
}

export function toChange(input: ChangeInput): PositionChange {
  const { candidate, currentPctNav, targetPctNav } = input

  return {
    kind: 'position-change',
    instrument: candidate.instrument,
    segment: candidate.segment,
    ...(candidate.sector === undefined ? {} : { sector: candidate.sector }),
    ...(candidate.instrumentKind === undefined ? {} : { instrumentKind: candidate.instrumentKind }),
    currentPctNav,
    targetPctNav,
    changePctNav: targetPctNav - currentPctNav,
    reason: input.reason,
    caveats: candidate.caveats,
  }
}
