// The buy side of a plan: what each segment's slice of free cash pays for, and what it leaves
// unfunded. Paired with `rebalance-reduce.ts`, which frees rather than spends.

import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
import type { RowInput } from '@/trading/features/portfolio/folds/rebalance-step'
import type { OrderSize, PositionChange } from '@/trading/features/portfolio/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { MarketRef, PortfolioSegment } from '@/trading/kernel/instrument'
import { segmentEntries } from '@/trading/features/portfolio/folds/allocation'
import { deploymentScale, turnoverCapPctNav } from '@/trading/features/portfolio/folds/policy'
import {
  increaseBelowMinimumCaveat,
  isReportableGap,
  standingReduceCaveat,
} from '@/trading/features/portfolio/folds/rebalance-caveat'
import {
  minimumStep,
  pacedStep,
  roundToLot,
  sizeOf,
  toChange,
  tradeable,
} from '@/trading/features/portfolio/folds/rebalance-step'
import { FULL_DEPLOYMENT_SCALE, regimeFor } from '@/trading/markets/macro-risk'

interface Increases {
  readonly rows: readonly PositionChange[]
  readonly caveats: readonly Caveat[]
  readonly shortfallBySegment: ReadonlyMap<PortfolioSegment, number>
}

interface SegmentBudgets {
  readonly bySegment: ReadonlyMap<PortfolioSegment, number>
  /** The share of free cash the segment budgets actually opened, for the header that states it. */
  readonly deploymentScale: number
}

// Funded only by cash above the reserve: proposed sale proceeds never fund a same-run buy.
export function increaseRows(
  rows: RowInput,
  sizes: Map<string, OrderSize>,
  budgets: Map<PortfolioSegment, number>
): Increases {
  const changes: PositionChange[] = []
  const caveats: Caveat[] = []
  const shortfallBySegment = new Map<PortfolioSegment, number>()

  for (const [key, wanted] of [...rows.desired].sort(byDescendingWeight)) {
    const candidate = rows.candidates.get(key)

    if (!(candidate && rows.drifting.has(candidate.segment))) {
      continue
    }

    // Before the budget is touched, so a suppressed name never spends its segment's slice. Adding to
    // a holding the evidence has turned against is the one buy this plan must not propose.
    if (rows.input.standingReduces.has(key)) {
      caveats.push(standingReduceCaveat(candidate))
      continue
    }

    const currentPctNav = rows.current.get(key) ?? 0
    const minimum = minimumStep(rows, candidate)
    const shortfall = wanted - currentPctNav

    if (shortfall < minimum) {
      caveats.push(...belowMinimumCaveats(candidate, shortfall, minimum))
      continue
    }

    const budget = budgets.get(candidate.segment) ?? 0
    const funded = fundedStep({ rows, candidate, minimum, budget, shortfall })

    shortfallBySegment.set(
      candidate.segment,
      (shortfallBySegment.get(candidate.segment) ?? 0) + funded.shortfallPctNav
    )

    if (funded.rounded < minimum) {
      continue
    }

    budgets.set(candidate.segment, budget - funded.cashPctNav)

    const change = toChange({
      candidate,
      currentPctNav,
      targetPctNav: currentPctNav + funded.rounded,
      reason: { kind: rows.cores.has(key) ? 'core-fill' : 'fill-gap' },
    })

    changes.push(change)
    sizes.set(key, sizeOf(change, candidate, rows.nav))
  }

  return { rows: changes, caveats, shortfallBySegment }
}

/** A gap under the plan's own smallest step never trades, so the name sits under target run after
 *  run. Said out loud, or the plan reports a convergence it is not making. A name already at target
 *  has no gap to report. */
function belowMinimumCaveats(
  candidate: PortfolioCandidate,
  shortfall: number,
  minimum: number
): readonly Caveat[] {
  return isReportableGap(shortfall)
    ? [increaseBelowMinimumCaveat(candidate, shortfall, minimum)]
    : []
}

interface FundedStep {
  readonly rounded: number
  /** What buying `rounded` draws from the segment's budget: its value and the fee on top. */
  readonly cashPctNav: number
  readonly shortfallPctNav: number
}

interface FundInput {
  readonly rows: RowInput
  readonly candidate: PortfolioCandidate
  readonly minimum: number
  readonly budget: number
  readonly shortfall: number
}

/** The lot-rounded step this segment's budget pays for, fee included, and what cash left uncovered. A
 *  step too small to clear the gate even with unlimited cash reports no shortfall: a turnover clamp
 *  or lot residue was never a funding gap. */
function fundedStep(input: FundInput): FundedStep {
  const { rows, candidate, minimum, budget } = input
  const absorbable = Math.min(
    tradeable(increaseStep(input.shortfall, candidate.segment, rows), input.shortfall, minimum),
    turnoverCapPctNav(candidate.averageDailyTurnoverBase, rows.nav)
  )

  if (roundToLot(absorbable, candidate, rows.nav) < minimum) {
    return { rounded: 0, cashPctNav: 0, shortfallPctNav: 0 }
  }

  // The reserve is cash the buy and its fee must leave untouched, so the budget buys less than its face.
  const draw = rows.input.buyCashMultiple(candidate.instrument.market)
  const affordable = budget / draw
  const rounded = roundToLot(Math.min(absorbable, affordable), candidate, rows.nav)

  return {
    rounded,
    cashPctNav: rounded * draw,
    shortfallPctNav: Math.max(0, absorbable - affordable),
  }
}

function increaseStep(shortfall: number, segment: PortfolioSegment, rows: RowInput): number {
  const gap = rows.segments.get(segment)
  const under = Math.max(0, -(rows.drifting.get(segment) ?? 0))

  return pacedStep(shortfall, under, gap?.shortfall ?? 0)
}

/** The pool is split by profile target weight and each slice held to its own segment's macro, so a
 *  defensive segment holds back its share instead of the whole book. An unspent slice stays cash:
 *  one segment's macro never licenses spending another's. Each slice is then clamped to the cash its
 *  own market can reach — a plan that budgets money sitting at another venue is one the sizer
 *  trims back with a caveat, so the plan states what is fundable up front. */
export function segmentBudgets(rows: RowInput): SegmentBudgets {
  const { profile } = rows.input
  const availablePctNav = rows.input.valued.book.availableCashBase / rows.nav
  const spendable = Math.max(0, availablePctNav - profile.reservePctNav)
  const funded = fundedTargets(rows)

  if (funded.size === 0) {
    // Nothing to buy today: the scale still states what the segments' macro would allow.
    return { bySegment: new Map(), deploymentScale: blendedScale(rows, allTargets(rows)) }
  }

  const shares = scaleShares(rows, funded)
  const markets = marketBySegment(rows)

  return {
    bySegment: new Map(
      [...shares].map(([segment, share]) => [
        segment,
        clampToReachable(rows, { segment, markets, slice: spendable * share }),
      ])
    ),
    deploymentScale: sumOf(shares),
  }
}

/** Each segment's weight in the targets times the scale its macro allows. */
function scaleShares(
  rows: RowInput,
  targets: ReadonlyMap<PortfolioSegment, number>
): ReadonlyMap<PortfolioSegment, number> {
  const { profile } = rows.input
  const targeted = sumOf(targets)

  return new Map(
    [...targets].map(([segment, target]) => [
      segment,
      targeted <= 0
        ? 0
        : (target / targeted) *
          deploymentScale(regimeFor(rows.input.regimes, segment).scale, profile.regimeScale),
    ])
  )
}

function blendedScale(rows: RowInput, targets: ReadonlyMap<PortfolioSegment, number>): number {
  return sumOf(targets) > 0
    ? sumOf(scaleShares(rows, targets))
    : deploymentScale(FULL_DEPLOYMENT_SCALE, rows.input.profile.regimeScale)
}

function allTargets(rows: RowInput): ReadonlyMap<PortfolioSegment, number> {
  return new Map(
    segmentEntries(rows.input.profile.segmentTargets).filter(
      ([segment, target]) => target > 0 && rows.input.regimes.has(segment)
    )
  )
}

function sumOf(values: ReadonlyMap<PortfolioSegment, number>): number {
  return [...values.values()].reduce((sum, value) => sum + value, 0)
}

/** One segment's market, read off its candidates: a segment belongs to exactly one market, so the
 *  first candidate holding it names the segment's. Absent where the segment holds nothing yet. */
function marketBySegment(rows: RowInput): ReadonlyMap<PortfolioSegment, MarketRef> {
  const markets = new Map<PortfolioSegment, MarketRef>()

  for (const candidate of rows.candidates.values()) {
    if (!markets.has(candidate.segment)) {
      markets.set(candidate.segment, candidate.instrument.market)
    }
  }

  return markets
}

/** A segment may draw on the whole book's spendable pool only up to what its own market's venues
 *  hold. A market no order-placing venue serves is one the operator trades by hand, so its slice
 *  is unclamped rather than zeroed. */
function clampToReachable(
  rows: RowInput,
  segment: {
    readonly segment: PortfolioSegment
    readonly markets: ReadonlyMap<PortfolioSegment, MarketRef>
    readonly slice: number
  }
): number {
  const market = segment.markets.get(segment.segment)
  const reachable = market === undefined ? undefined : rows.input.reachableCashBase.get(market)

  if (reachable === undefined) {
    return segment.slice
  }

  return Math.min(segment.slice, reachable / rows.nav)
}

/** Only segments with a name to add share the pool: one with nothing to buy would hold back a slice
 *  no order could spend. */
function fundedTargets(rows: RowInput): ReadonlyMap<PortfolioSegment, number> {
  const targets = new Map(segmentEntries(rows.input.profile.segmentTargets))
  const funded = new Map<PortfolioSegment, number>()

  for (const [key, wanted] of rows.desired) {
    const candidate = rows.candidates.get(key)

    if (
      candidate &&
      rows.drifting.has(candidate.segment) &&
      wanted > (rows.current.get(key) ?? 0)
    ) {
      funded.set(candidate.segment, Math.max(targets.get(candidate.segment) ?? 0, 0))
    }
  }

  return funded
}

function byDescendingWeight(
  left: readonly [string, number],
  right: readonly [string, number]
): number {
  return right[1] - left[1] || left[0].localeCompare(right[0])
}
