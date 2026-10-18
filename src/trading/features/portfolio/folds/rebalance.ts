// The plan itself: which segments have drifted far enough to trade, how far each name sits from its
// desired weight, and the two sides run against that. The sides live in `rebalance-reduce.ts` and
// `rebalance-increase.ts`; the arithmetic they share lives in `rebalance-step.ts`.

import type { AdviceInput, DesiredWeights } from '@/trading/features/portfolio/folds/allocation'
import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
import type { RowInput, SegmentGap } from '@/trading/features/portfolio/folds/rebalance-step'
import type {
  AbsoluteRebalancePlan,
  OrderSize,
  PositionChange,
  RebalancePlanResult,
  RebalanceSizing,
} from '@/trading/features/portfolio/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import {
  currentPositionWeights,
  currentSegmentWeights,
  segmentEntries,
} from '@/trading/features/portfolio/folds/allocation'
import { driftBand } from '@/trading/features/portfolio/folds/policy'
import { underfundedCaveats } from '@/trading/features/portfolio/folds/rebalance-caveat'
import { increaseRows, segmentBudgets } from '@/trading/features/portfolio/folds/rebalance-increase'
import { reductionRows } from '@/trading/features/portfolio/folds/rebalance-reduce'
import { buildInstrumentKey } from '@/trading/kernel/instrument'

interface RebalancePlan {
  readonly rows: readonly PositionChange[]
  readonly sizes: ReadonlyMap<string, OrderSize>
  readonly caveats: readonly Caveat[]
  /** The share of free cash the segment budgets actually opened, for the header that states it. */
  readonly deploymentScale: number
}

/** Only rows that survive the drift, cap, liquidity, lot, and minimum-change rules. Reductions are
 *  clamped to settled quantity; increases are limited to available cash, because proposed sale
 *  proceeds are not settled and cannot fund a buy in the same run. */
export function rebalanceRows(
  input: AdviceInput,
  nav: number,
  desired: DesiredWeights
): RebalancePlan {
  const current = currentPositionWeights(input.valued, nav)
  const drifting = driftingSegments(input, nav)
  const candidates = new Map(
    input.candidates.map((candidate) => [buildInstrumentKey(candidate.instrument), candidate])
  )
  const rows: RowInput = {
    input,
    nav,
    desired: desired.byInstrument,
    current,
    drifting,
    candidates,
    segments: segmentGaps(desired.byInstrument, current, candidates),
    cores: desired.cores,
  }
  const sizes = new Map<string, OrderSize>()
  const budgets = segmentBudgets(rows)
  const reductions = reductionRows(rows, sizes)
  const increases = increaseRows(rows, sizes, new Map(budgets.bySegment))

  return {
    rows: [...reductions.rows, ...increases.rows],
    sizes,
    deploymentScale: budgets.deploymentScale,
    caveats: [
      ...reductions.caveats,
      ...increases.caveats,
      ...underfundedCaveats({
        shortfallBySegment: increases.shortfallBySegment,
        nav,
        baseCurrency: input.valued.book.baseCurrency,
        policy: input.rebalancePolicy,
      }),
    ],
  }
}

// A segment inside its band is left alone: trading it spends spread and fees on a deviation policy
// already calls acceptable. The value is the signed gap to target, which is the part of a move that
// is not a rotation.
function driftingSegments(input: AdviceInput, nav: number): ReadonlyMap<PortfolioSegment, number> {
  const current = currentSegmentWeights(input.valued)
  const drifting = new Map<PortfolioSegment, number>()

  for (const [segment, target] of segmentEntries(input.profile.segmentTargets)) {
    const held = current.get(segment) ?? 0

    // Equality triggers: at the band is the edge policy defined as too far.
    if (Math.abs(held - target) >= driftBand(target, input.rebalancePolicy)) {
      drifting.set(segment, held - target)
    }
  }

  return nav > 0 ? drifting : new Map<PortfolioSegment, number>()
}

/** How far a segment's names sit from their desired weights, each way. The segment's own gap is shared
 *  in proportion to these, so the prompt parts add up to exactly that gap and no more. */
function segmentGaps(
  desired: ReadonlyMap<string, number>,
  current: ReadonlyMap<string, number>,
  candidates: ReadonlyMap<string, PortfolioCandidate>
): ReadonlyMap<PortfolioSegment, SegmentGap> {
  const gaps = new Map<PortfolioSegment, SegmentGap>()
  const keys = new Set([...current.keys(), ...desired.keys()])

  for (const key of keys) {
    const segment = candidates.get(key)?.segment

    if (segment === undefined) {
      continue
    }

    const held = current.get(key) ?? 0
    const wanted = desired.get(key) ?? 0
    const gap = gaps.get(segment) ?? { excess: 0, shortfall: 0 }

    gaps.set(segment, {
      excess: gap.excess + Math.max(0, held - wanted),
      shortfall: gap.shortfall + Math.max(0, wanted - held),
    })
  }

  return gaps
}

/** The relative plan with each row's order quantity: a broker order's `units`, never its value. */
export function withOrderUnits(plan: AbsoluteRebalancePlan): RebalancePlanResult {
  const { advice, sizing } = plan

  if (advice.kind !== 'ready' || sizing === null) {
    return advice
  }

  return { ...advice, rebalance: advice.rebalance.map((row) => withUnits(row, sizing)) }
}

function withUnits(row: PositionChange, sizing: RebalanceSizing): PositionChange {
  const size = sizing.byInstrument.get(buildInstrumentKey(row.instrument))

  return size === undefined ? row : { ...row, units: size.quantity }
}
