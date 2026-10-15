// The sell side of a plan: what a held name gives back, clamped to settled quantity and to what the
// name's own turnover absorbs. Paired with `rebalance-increase.ts`, which spends rather than frees.

import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
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
  turnoverCapPctNav,
  WEAK_HOLDING_SIGNAL_THRESHOLD,
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

  if (!(candidate && rows.drifting.has(candidate.segment))) {
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
  // An exit is not a rotation: a name the plan no longer wants leaves whole, held back only by
  // settlement and turnover. Pacing applies to a trim toward a weight the plan still holds.
  const step = wanted > 0 ? reductionStep(excess, candidate.segment, rows) : excess

  // The lot rule alone: a gap under one lot is a standing state worth a line, while a settlement
  // or turnover clamp is explained by the row that states it.
  if (roundToLot(tradeable(step, excess, minimum), sizing, rows.nav) < minimum) {
    return isReportableGap(excess)
      ? { kind: 'below-minimum', caveat: reductionBelowMinimumCaveat(candidate, excess, minimum) }
      : { kind: 'none' }
  }

  return reductionChange(entry, rows, {
    candidate,
    currentPctNav,
    wanted,
    step,
    excess,
    minimum,
  })
}

interface ReductionSizing {
  readonly candidate: PortfolioCandidate
  readonly currentPctNav: number
  readonly wanted: number
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
  const reducible = Math.min(
    tradeable(sizing.step, sizing.excess, minimum),
    settledPctNav,
    turnoverCapPctNav(candidate.averageDailyTurnoverBase, rows.nav)
  )
  const rounded = roundToLot(reducible, lot, rows.nav)

  if (rounded < minimum) {
    return { kind: 'none' }
  }

  return {
    kind: 'change',
    change: toChange({
      candidate,
      currentPctNav: sizing.currentPctNav,
      targetPctNav: sizing.currentPctNav - rounded,
      reason: reductionReason(candidate, sizing.wanted),
    }),
    candidate,
  }
}

function reductionStep(excess: number, segment: PortfolioSegment, rows: RowInput): number {
  const sleeve = rows.sleeves.get(segment)
  const over = Math.max(0, rows.drifting.get(segment) ?? 0)

  return pacedStep(excess, over, sleeve?.excess ?? 0)
}

/** A weight the plan still wants is being cut back by the allocation math; one at zero means the
 *  name is leaving, and only its score separates a weak read from a sleeve policy stopped funding. */
function reductionReason(candidate: PortfolioCandidate, wanted: number): ChangeReason {
  if (wanted > 0) {
    return { kind: 'trim' }
  }

  return candidate.marketScore <= WEAK_HOLDING_SIGNAL_THRESHOLD
    ? { kind: 'weak-signal', signal: candidate.marketScore }
    : { kind: 'off-policy' }
}
