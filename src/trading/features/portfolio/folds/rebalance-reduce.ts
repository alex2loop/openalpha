// The sell side of a plan: what a held name gives back, clamped to settled quantity and to what the
// name's own turnover absorbs. Paired with `rebalance-increase.ts`, which spends rather than frees.

import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
import type { CapTrim, RebalancePolicy } from '@/trading/features/portfolio/folds/policy'
import type { RowInput } from '@/trading/features/portfolio/folds/rebalance-step'
import type {
  ChangeReason,
  OrderSize,
  PositionChange,
  ValuedPosition,
} from '@/trading/features/portfolio/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import {
  driftBand,
  isWeakHolding,
  turnoverCapPctNav,
} from '@/trading/features/portfolio/folds/policy'
import {
  isReportableGap,
  reductionBelowMinimumCaveat,
} from '@/trading/features/portfolio/folds/rebalance-caveat'
import {
  minimumStep,
  pacedStep,
  roundToLot,
  sizeOf,
  toChange,
  tradeable,
} from '@/trading/features/portfolio/folds/rebalance-step'
import { buildInstrumentKey } from '@/trading/kernel/instrument'

interface Reductions {
  readonly rows: readonly PositionChange[]
  readonly caveats: readonly Caveat[]
}

export function reductionRows(rows: RowInput, sizes: Map<string, OrderSize>): Reductions {
  const changes: PositionChange[] = []
  const caveats: Caveat[] = []

  for (const entry of rows.input.valued.positions) {
    if (entry.kind !== 'priced') {
      continue
    }

    const outcome = reductionFor(entry, rows)

    if (outcome.kind === 'change') {
      changes.push(outcome.change)
      sizes.set(
        buildInstrumentKey(outcome.change.instrument),
        sizeOf(outcome.change, outcome.candidate, rows.nav)
      )
    } else if (outcome.kind === 'below-minimum') {
      caveats.push(outcome.caveat)
    }
  }

  return { rows: changes, caveats }
}

type ReductionOutcome =
  | {
      readonly kind: 'change'
      readonly change: PositionChange
      readonly candidate: PortfolioCandidate
    }
  | { readonly kind: 'below-minimum'; readonly caveat: Caveat }
  | { readonly kind: 'none' }

function reductionFor(
  entry: Extract<ValuedPosition, { readonly kind: 'priced' }>,
  rows: RowInput
): ReductionOutcome {
  const key = buildInstrumentKey(entry.position.instrument)
  const candidate = rows.candidates.get(key)
  const trim = rows.capTrims.get(key)

  if (candidate === undefined || (trim === undefined && !rows.drifting.has(candidate.segment))) {
    return { kind: 'none' }
  }

  const currentPctNav = rows.current.get(key) ?? 0
  const wanted = rows.desired.get(key) ?? 0

  if (wanted >= currentPctNav) {
    return { kind: 'none' }
  }

  const sizing = { boardLot: candidate.boardLot, unitPriceBase: entry.priceBase }
  const minimum = minimumStep(rows, sizing)
  const excess = currentPctNav - wanted
  const step = saleStepOf(excess, { candidate, currentPctNav, wanted, trim }, rows)

  // The lot rule alone: a gap under one lot is a standing state worth a line, while a settlement
  // or turnover clamp is explained by the row that states it.
  if (
    trim === undefined &&
    roundToLot(tradeable(step, excess, minimum), sizing, rows.nav) < minimum
  ) {
    return isReportableGap(excess)
      ? { kind: 'below-minimum', caveat: reductionBelowMinimumCaveat(candidate, excess, minimum) }
      : { kind: 'none' }
  }

  return reductionChange(entry, rows, {
    candidate,
    currentPctNav,
    wanted,
    trim,
    step,
    excess,
    minimum,
  })
}

interface ReductionSizing {
  readonly candidate: PortfolioCandidate
  readonly currentPctNav: number
  readonly wanted: number
  readonly trim: CapTrim | undefined
  readonly step: number
  readonly excess: number
  readonly minimum: number
}

/** Only settled quantity can be sold today, and only what the name's turnover absorbs. Either clamp
 *  can round the step away; the row is then dropped silently, because the line that states the
 *  clamp already explains it. */
function reductionChange(
  entry: Extract<ValuedPosition, { readonly kind: 'priced' }>,
  rows: RowInput,
  sizing: ReductionSizing
): ReductionOutcome {
  const { candidate, minimum } = sizing
  const lot = { boardLot: candidate.boardLot, unitPriceBase: entry.priceBase }
  const settledPctNav = (entry.position.settledQuantity * entry.priceBase) / rows.nav
  const limit = Math.min(
    settledPctNav,
    turnoverCapPctNav(candidate.averageDailyTurnoverBase, rows.nav)
  )
  const reducible = Math.min(tradeable(sizing.step, sizing.excess, minimum), limit)
  const rounded = clearingSale(roundToLot(reducible, lot, rows.nav), sizing, {
    lot,
    limit,
    nav: rows.nav,
    policy: rows.input.rebalancePolicy,
  })

  if (rounded < minimum) {
    return { kind: 'none' }
  }

  return {
    kind: 'change',
    change: toChange({
      candidate,
      currentPctNav: sizing.currentPctNav,
      targetPctNav: sizing.currentPctNav - rounded,
      reason: reductionReason(candidate, sizing),
    }),
    candidate,
  }
}

interface SaleRoom {
  readonly lot: { readonly boardLot: number; readonly unitPriceBase: number }
  /** What settlement and turnover let the name sell today, as a fraction of NAV. */
  readonly limit: number
  readonly nav: number
  readonly policy: RebalancePolicy
}

/** A cap breach is cleared, not approached: where the lot-floored sale still leaves the name past
 *  the weight its trim allows plus the band, one more lot goes if settlement and turnover allow.
 *  Otherwise a book whose lot outweighs the band would sit above its cap for good. */
function clearingSale(floored: number, sizing: ReductionSizing, room: SaleRoom): number {
  const { trim } = sizing

  if (
    trim === undefined ||
    sizing.currentPctNav - floored < trim.toPctNav + driftBand(trim.capPctNav, room.policy)
  ) {
    return floored
  }

  const lotPctNav = (room.lot.boardLot * room.lot.unitPriceBase) / room.nav

  return Math.max(
    floored,
    roundToLot(Math.min(floored + lotPctNav, room.limit), room.lot, room.nav)
  )
}

type SaleGap = Pick<ReductionSizing, 'candidate' | 'currentPctNav' | 'wanted' | 'trim'>

/** An exit is not a rotation: a name the plan no longer wants leaves whole, held back only by
 *  settlement and turnover. Pacing applies to a trim toward a weight the plan still holds, except
 *  the part that brings a capped name back to its cap, which goes in one step. */
function saleStepOf(excess: number, gap: SaleGap, rows: RowInput): number {
  if (gap.wanted <= 0) {
    return excess
  }

  const paced = reductionStep(excess, gap.candidate.segment, rows)

  if (gap.trim === undefined) {
    return paced
  }

  return Math.min(excess, Math.max(paced, gap.currentPctNav - gap.trim.toPctNav))
}

function reductionStep(excess: number, segment: PortfolioSegment, rows: RowInput): number {
  const gap = rows.segments.get(segment)
  const over = Math.max(0, rows.drifting.get(segment) ?? 0)

  return pacedStep(excess, over, gap?.excess ?? 0)
}

/** A weak read leaves whole whatever the cap says. Past that, a breached cap names the sale while
 *  the plan still wants the name, or when the sector room is what zeroed it; a name the cap leaves
 *  room for but the plan wants none of is leaving because its segment is off. */
function reductionReason(
  candidate: PortfolioCandidate,
  sizing: Pick<ReductionSizing, 'wanted' | 'trim'>
): ChangeReason {
  const { wanted, trim } = sizing

  if (wanted <= 0 && isWeakHolding(candidate.marketScore, candidate.instrumentKind)) {
    return { kind: 'weak-signal', signal: candidate.marketScore }
  }

  if (trim !== undefined && (wanted > 0 || trim.toPctNav <= 0)) {
    return { kind: 'over-cap', limit: trim.limit, cap: trim.capPctNav }
  }

  return wanted <= 0 ? { kind: 'off-policy' } : { kind: 'trim' }
}
