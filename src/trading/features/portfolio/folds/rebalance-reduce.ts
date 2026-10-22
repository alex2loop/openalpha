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
    } else if (outcome.kind === 'held-back') {
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
  | { readonly kind: 'held-back'; readonly caveat: Caveat }
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
  // or turnover clamp gets its own line below.
  if (
    trim === undefined &&
    roundToLot(tradeable(step, excess, minimum), sizing, rows.nav) < minimum
  ) {
    return isReportableGap(excess)
      ? { kind: 'held-back', caveat: reductionBelowMinimumCaveat(candidate, excess, minimum) }
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
    excluded: rows.excluded.has(key),
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
  /** On the exclusion list: kept rather than exited on its score, so only a cap ever sells it. */
  readonly excluded: boolean
}

interface SaleClamps {
  /** What has settled, as a fraction of NAV. */
  readonly settledPctNav: number
  /** Part of the holding is still on its way, which is what can leave too little settled. */
  readonly unsettled: boolean
  /** What the name's turnover absorbs in a day, as a fraction of NAV. */
  readonly turnoverPctNav: number
}

/** Only settled quantity can be sold today, and only what the name's turnover absorbs. A sale either
 *  clamp holds back is said, or a name past its limit with no order beside it reads as one the plan
 *  missed. */
function reductionChange(
  entry: Extract<ValuedPosition, { readonly kind: 'priced' }>,
  rows: RowInput,
  sizing: ReductionSizing
): ReductionOutcome {
  const { candidate, minimum } = sizing
  const lot = { boardLot: candidate.boardLot, unitPriceBase: entry.priceBase }
  const clamps: SaleClamps = {
    settledPctNav: (entry.position.settledQuantity * entry.priceBase) / rows.nav,
    unsettled: entry.position.settledQuantity < entry.position.quantity,
    turnoverPctNav: turnoverCapPctNav(candidate.averageDailyTurnoverBase, rows.nav),
  }
  const limit = Math.min(clamps.settledPctNav, clamps.turnoverPctNav)
  const reducible = Math.min(tradeable(sizing.step, sizing.excess, minimum), limit)
  const rounded = clearingSale(roundToLot(reducible, lot, rows.nav), sizing, {
    lot,
    limit,
    nav: rows.nav,
    policy: rows.input.rebalancePolicy,
  })

  if (rounded < minimum) {
    const caveat = heldBackCaveat(sizing, clamps)

    return caveat === null ? { kind: 'none' } : { kind: 'held-back', caveat }
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

/** Settlement first: it clears by itself within days, while thin turnover stays. A sale neither
 *  clamp holds back is a lot rounding the plan already reports elsewhere. */
function heldBackCaveat(
  sizing: Pick<ReductionSizing, 'candidate' | 'excess' | 'minimum'>,
  clamps: SaleClamps
): Caveat | null {
  if (!isReportableGap(sizing.excess)) {
    return null
  }

  const detail = { ticker: sizing.candidate.instrument.ticker, gap: sizing.excess }

  if (clamps.unsettled && clamps.settledPctNav < sizing.minimum) {
    return { code: 'portfolio.reduction-unsettled', detail }
  }

  return clamps.turnoverPctNav < sizing.minimum
    ? { code: 'portfolio.reduction-illiquid', detail }
    : null
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

/** A weak read leaves whole whatever the cap says, unless the name is excluded. Past that, a breached cap names the sale while
 *  the plan still wants the name, or when the sector room is what zeroed it; a name the cap leaves
 *  room for but the plan wants none of is leaving because its segment is off. */
function reductionReason(
  candidate: PortfolioCandidate,
  sizing: Pick<ReductionSizing, 'wanted' | 'trim' | 'excluded'>
): ChangeReason {
  const { wanted, trim } = sizing

  if (
    wanted <= 0 &&
    !sizing.excluded &&
    isWeakHolding(candidate.marketScore, candidate.instrumentKind)
  ) {
    return { kind: 'weak-signal', signal: candidate.marketScore }
  }

  if (trim !== undefined && (wanted > 0 || trim.toPctNav <= 0)) {
    return { kind: 'over-cap', limit: trim.limit, cap: trim.capPctNav }
  }

  return wanted <= 0 ? { kind: 'off-policy' } : { kind: 'trim' }
}
