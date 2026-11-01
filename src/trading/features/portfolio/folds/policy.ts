import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
import type { CapReason, SegmentValue } from '@/trading/features/portfolio/types'
import type { InstrumentKind } from '@/trading/kernel/instrument'
import type { RiskCapSet, UserProfile } from '@/trading/kernel/operator/profile'
import { buildInstrumentKey, ETF_KIND } from '@/trading/kernel/instrument'
import { isEtfUnmeasured } from '@/trading/kernel/operator/exposure'
import { isCappedAsFund, positionCapOf } from '@/trading/kernel/operator/profile'

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

/** How far a challenger tracker must outscore the core the segment already holds before the core
 *  moves to it. Funds on overlapping indices move together (VN30, VN100 and VNX50 correlated 0.98
 *  to 1.00 over 2026), so a small lead buys almost nothing and a switch pays a round trip. About a
 *  third of a fund score's 75th percentile, in line with the 20-50% buffers index providers use. */
const CORE_SWITCH_MARGIN = 0.15

/** How much of a rotation — the part of a move that is not the segment closing its gap — one run may
 *  take. Suggestions accumulate; the segment's own gap is closed promptly and is not scaled here. */
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

/** Sessions to exit a holding at the participation ceiling. Absent when turnover is unmeasured or
 *  zero: a name that trades nothing has no session count to print (the liquidity ceilings cap it
 *  at nothing instead). */
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
 *  Using `max` would make bands 2-4x too wide — a 5% segment would not rebalance until it doubled. */
export function driftBand(target: number, policy: RebalancePolicy): number {
  return Math.min(policy.absoluteDriftPctPoints, target * policy.relativeDriftPct)
}

/** The weight a segment's ETFs may reach together, for a plan that sets absolute weights: unbounded
 *  where the segment declares no ceiling, and none at all where it holds a priced position whose
 *  kind never resolved — a ceiling that cannot see the weight must not act as if there were room,
 *  the same way `capFor` fails closed on a missing cap. */
export function etfCeilingPctNav(cap: RiskCapSet | undefined, segment?: SegmentValue): number {
  const ceiling = cap?.maximumEtfPctNav

  if (ceiling === undefined) {
    return Number.POSITIVE_INFINITY
  }

  return isEtfUnmeasured(segment) ? 0 : ceiling
}

/** Room under a segment's ETF ceiling for a purchase added to what the segment already holds: the
 *  whole ceiling where the book holds nothing there yet. */
export function etfHeadroomPctNav(cap: RiskCapSet | undefined, segment?: SegmentValue): number {
  return Math.max(0, etfCeilingPctNav(cap, segment) - (segment?.etfPctNav ?? 0))
}

/** A held name past its own cap, or its sector's, by more than the band. */
export interface CapTrim {
  readonly limit: CapReason
  readonly capPctNav: number
  /** The weight the sale brings the name back to. */
  readonly toPctNav: number
}

interface SectorLimits {
  readonly cap: number
  /** The sector weight a cut fires at: the cap plus its band. */
  readonly trigger: number
  readonly excluded: ReadonlySet<string>
}

interface CapTrimRequest {
  readonly profile: UserProfile
  readonly candidates: readonly PortfolioCandidate[]
  /** Current weights, keyed by `buildInstrumentKey`. */
  readonly held: ReadonlyMap<string, number>
  readonly rebalancePolicy: RebalancePolicy
  /** The exclusion list by instrument key. */
  readonly excluded: ReadonlySet<string>
}

/** A fund is never sold on its own score: a bearish read on an index is a call on the market, which
 *  the segment's weight and regime already answer, and an exit on a two-month trend whipsaws. */
export function isWeakHolding(score: number, kind: InstrumentKind | undefined): boolean {
  return kind !== ETF_KIND && score <= WEAK_HOLDING_SIGNAL_THRESHOLD
}

/** Equal scores and equal room must produce stable output, not insertion-order output. Funds on one
 *  index score the same, so the one that trades most leads: its spread is what a holder pays. */
export function compareCandidates(left: PortfolioCandidate, right: PortfolioCandidate): number {
  return (
    right.marketScore - left.marketScore ||
    (right.averageDailyTurnoverBase ?? 0) - (left.averageDailyTurnoverBase ?? 0) ||
    left.instrument.market.localeCompare(right.instrument.market) ||
    left.instrument.ticker.localeCompare(right.instrument.ticker)
  )
}

/** The segment's core and the tracker that carries it. One tracker, not every ETF in the segment: two
 *  trackers of the same index buy that exposure twice and pay the spread twice, so the floor goes to
 *  the best-ranked one and the rest compete on score like any other name. A tracker already held
 *  keeps the floor until another outscores it by `CORE_SWITCH_MARGIN`, so the core does not trade
 *  back and forth between funds that move together. */
export function coreOf(
  caps: RiskCapSet | undefined,
  candidates: readonly PortfolioCandidate[],
  held: ReadonlyMap<string, number>
): readonly [string, number] | undefined {
  const floor = caps?.minimumEtfPctNav

  if (floor === undefined || floor <= 0) {
    return undefined
  }

  const trackers = candidates
    .filter((candidate) => candidate.instrumentKind === ETF_KIND)
    .sort(compareCandidates)
  const [best] = trackers
  const incumbent = trackers.find(
    (candidate) => (held.get(buildInstrumentKey(candidate.instrument)) ?? 0) > 0
  )

  if (best === undefined) {
    return undefined
  }

  const core =
    incumbent !== undefined && best.marketScore - incumbent.marketScore < CORE_SWITCH_MARGIN
      ? incumbent
      : best

  return [buildInstrumentKey(core.instrument), floor]
}

/** Back to the cap, not to a target: under proportional costs the no-trade region ends at the cap.
 *  A cap of zero trims nothing: the segment has no caps record, or is off and exits whole. */
export function capTrims(request: CapTrimRequest): ReadonlyMap<string, CapTrim> {
  const positions = positionTrims(request)

  return new Map([...positions, ...sectorTrims(request, positions)])
}

function positionTrims(request: CapTrimRequest): ReadonlyMap<string, CapTrim> {
  const trims = new Map<string, CapTrim>()

  for (const candidate of request.candidates) {
    const key = buildInstrumentKey(candidate.instrument)
    const weight = request.held.get(key) ?? 0
    const caps = request.profile.caps[candidate.segment]
    const cap = positionCapOf(caps, candidate.instrumentKind)

    if (weight > 0 && cap > 0 && weight >= cap + driftBand(cap, request.rebalancePolicy)) {
      const limit = isCappedAsFund(caps, candidate.instrumentKind) ? 'etf' : 'position'

      trims.set(key, { limit, capPctNav: cap, toPctNav: cap })
    }
  }

  return trims
}

/** A sector past its cap gives the excess back from its weakest names first. A fund carries no
 *  sector weight, so the core floor is never cut. A segment the plan no longer funds leaves whole
 *  anyway, so its names take no room. Names already trimmed to their own cap count at that weight. */
function sectorTrims(
  request: CapTrimRequest,
  positions: ReadonlyMap<string, CapTrim>
): ReadonlyMap<string, CapTrim> {
  const cap = request.profile.maximumSectorPctNav
  const limits: SectorLimits = {
    cap,
    trigger: cap + driftBand(cap, request.rebalancePolicy),
    excluded: request.excluded,
  }
  const sectors = new Map<string, PortfolioCandidate[]>()
  const trims: (readonly [string, CapTrim])[] = []

  if (cap <= 0) {
    return new Map()
  }

  for (const candidate of request.candidates) {
    if (
      candidate.sector !== undefined &&
      candidate.instrumentKind !== ETF_KIND &&
      (request.profile.segmentTargets[candidate.segment] ?? 0) > 0
    ) {
      sectors.set(candidate.sector, [...(sectors.get(candidate.sector) ?? []), candidate])
    }
  }

  for (const members of sectors.values()) {
    const weights = members.map((member) => {
      const key = buildInstrumentKey(member.instrument)

      return [member, positions.get(key)?.toPctNav ?? request.held.get(key) ?? 0] as const
    })
    const total = weights.reduce((sum, [, weight]) => sum + weight, 0)

    if (total >= limits.trigger) {
      trims.push(...cutWeakestFirst(weights, limits))
    }
  }

  return new Map(trims)
}

/** Weak names go first and whole, since the plan wants none of them. When their exits alone bring
 *  the sector back inside its band, the rest keep their weight, as the next run would leave them;
 *  otherwise the rest are cut back to the cap. */
function cutWeakestFirst(
  weights: readonly (readonly [PortfolioCandidate, number])[],
  limits: SectorLimits
): readonly (readonly [string, CapTrim])[] {
  const weakestFirst = [...weights].sort(([left], [right]) => compareCandidates(right, left))
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0)
  const exits = exitCuts(weakestFirst, total - limits.cap, limits)
  const kept = total - exits.freed

  if (kept < limits.trigger) {
    return exits.cuts
  }

  const staying = weakestFirst.filter(([member]) => !leavesWhole(member, limits))

  return [...exits.cuts, ...cutsToCap(staying, kept - limits.cap, limits.cap)]
}

/** A weak name the cut reaches is sold whole, so its whole weight is what it frees. An excluded one
 *  is kept rather than exited, so it is cut like any other name. */
function exitCuts(
  weakestFirst: readonly (readonly [PortfolioCandidate, number])[],
  excess: number,
  limits: SectorLimits
): { readonly cuts: readonly (readonly [string, CapTrim])[]; readonly freed: number } {
  const cuts: (readonly [string, CapTrim])[] = []
  let freed = 0

  for (const [member, weight] of weakestFirst) {
    if (freed >= excess) {
      break
    }

    if (weight > 0 && leavesWhole(member, limits)) {
      cuts.push([
        buildInstrumentKey(member.instrument),
        { limit: 'sector', capPctNav: limits.cap, toPctNav: 0 },
      ])
      freed += weight
    }
  }

  return { cuts, freed }
}

function leavesWhole(member: PortfolioCandidate, limits: SectorLimits): boolean {
  return (
    isWeakHolding(member.marketScore, member.instrumentKind) &&
    !limits.excluded.has(buildInstrumentKey(member.instrument))
  )
}

function cutsToCap(
  weakestFirst: readonly (readonly [PortfolioCandidate, number])[],
  excess: number,
  cap: number
): readonly (readonly [string, CapTrim])[] {
  const cuts: (readonly [string, CapTrim])[] = []
  let remaining = excess

  for (const [member, weight] of weakestFirst) {
    const cut = Math.min(weight, remaining)

    if (cut > 0) {
      cuts.push([
        buildInstrumentKey(member.instrument),
        { limit: 'sector', capPctNav: cap, toPctNav: weight - cut },
      ])
      remaining -= cut
    }
  }

  return cuts
}
