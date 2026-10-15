import type { SegmentValue } from '@/trading/features/portfolio/types'
import type { RiskCapSet } from '@/trading/kernel/operator/profile'
import { isEtfUnmeasured } from '@/trading/kernel/operator/exposure'

// Named `_FRACTION`, not `_PCT`: applied directly as a multiplier (0.2 means 20%), never scaled
// by 100 first.
const MAXIMUM_DAILY_TURNOVER_PARTICIPATION_FRACTION = 0.2
const MAXIMUM_DAYS_TO_LIQUIDATE = 5

/** Above this share of NAV deployed, a risk-off tape means the next move is raising cash, not
 *  adding a position. */
export const FULLY_INVESTED_PCT_NAV = 0.95

/** At or below this composite score a holding is weak: the advice section names it, and allocation
 *  stops reserving its weight. Entry stays gated at a positive score, so the gap between the two is
 *  the hysteresis that keeps a read wobbling around zero from forcing a liquidation. */
export const WEAK_HOLDING_SIGNAL_THRESHOLD = -0.3

/** How much of a rotation — the part of a move that is not the sleeve closing its gap — one run may
 *  take. Suggestions accumulate; the sleeve's own gap is closed promptly and is not scaled here. */
export const ROTATION_STEP_FRACTION = 1 / 3

/** Below this, dividing by volatility explodes the weight of a name that simply has not moved. */
export const MINIMUM_SIZING_VOLATILITY_DAILY = 0.005
/** What a name with no measured volatility is treated as: the rough middle of the VN band, so an
 *  unmeasured name is neither favoured nor punished against measured peers. */
export const DEFAULT_SIZING_VOLATILITY_DAILY = 0.025

/** What a name's turnover absorbs inside the liquidation window, as a fraction of NAV — the one
 *  liquidity ceiling shared by allocation and rebalance. An unmeasured turnover imposes no ceiling
 *  and is caveated by the caller: reading it as zero would forbid holding the name at all. */
export function turnoverCapPctNav(
  averageDailyTurnoverBase: number | undefined,
  nav: number
): number {
  if (averageDailyTurnoverBase === undefined || nav <= 0) {
    return Number.POSITIVE_INFINITY
  }

  return (
    (averageDailyTurnoverBase *
      MAXIMUM_DAILY_TURNOVER_PARTICIPATION_FRACTION *
      MAXIMUM_DAYS_TO_LIQUIDATE) /
    nav
  )
}

/** Sessions to exit a holding at the participation ceiling. Absent when turnover is unmeasured. */
export function daysToLiquidate(
  valueBase: number,
  averageDailyTurnoverBase: number | undefined
): number | undefined {
  if (averageDailyTurnoverBase === undefined || averageDailyTurnoverBase <= 0) {
    return undefined
  }

  return valueBase / (averageDailyTurnoverBase * MAXIMUM_DAILY_TURNOVER_PARTICIPATION_FRACTION)
}

export interface RebalancePolicy {
  readonly absoluteDriftPctPoints: number
  readonly relativeDriftPct: number
  readonly minimumChangePctNav: number
}

// The canonical 5/25 band.
export const DEFAULT_REBALANCE_POLICY: RebalancePolicy = Object.freeze({
  absoluteDriftPctPoints: 0.05,
  relativeDriftPct: 0.25,
  minimumChangePctNav: 0.005,
})

/** The one place the macro regime and the operator's ceiling combine: the scale reported on a plan
 *  and the scale it is built with both read it, so the two cannot drift apart. */
export function deploymentScale(regimeScale: number, profileScale: number): number {
  return Math.max(0, Math.min(regimeScale, profileScale, 1))
}

/** The 5/25 band: the TIGHTER of the two thresholds. The canonical rule is "5 percentage points
 *  absolute for large targets, 25% relative for small ones", and the two cross at a 20% target.
 *  Using `max` would make bands 2-4x too wide — a 5% sleeve would not rebalance until it doubled. */
export function driftBand(target: number, policy: RebalancePolicy): number {
  return Math.min(policy.absoluteDriftPctPoints, target * policy.relativeDriftPct)
}

/** The weight a sleeve's ETFs may reach together, for a plan that sets absolute weights: unbounded
 *  where the sleeve declares no ceiling, and none at all where it holds a priced position whose
 *  kind never resolved — a ceiling that cannot see the weight must not act as if there were room,
 *  the same way `capFor` fails closed on a missing cap. */
export function etfCeilingPctNav(cap: RiskCapSet | undefined, sleeve?: SegmentValue): number {
  const ceiling = cap?.maximumEtfPctNav

  if (ceiling === undefined) {
    return Number.POSITIVE_INFINITY
  }

  return isEtfUnmeasured(sleeve) ? 0 : ceiling
}

/** Room under a sleeve's ETF ceiling for a purchase added to what the sleeve already holds: the
 *  whole ceiling where the book holds nothing there yet. */
export function etfHeadroomPctNav(cap: RiskCapSet | undefined, sleeve?: SegmentValue): number {
  return Math.max(0, etfCeilingPctNav(cap, sleeve) - (sleeve?.etfPctNav ?? 0))
}
