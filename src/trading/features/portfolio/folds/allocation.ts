import type { PortfolioCandidate } from '@/trading/features/portfolio/folds/candidate'
import type { CapBind, Ceiling, CeilingFor } from '@/trading/features/portfolio/folds/distribution'
import type { CapTrim, RebalancePolicy } from '@/trading/features/portfolio/folds/policy'
import type {
  PortfolioAssessment,
  PositionChange,
  SegmentTarget,
  ValuedBook,
} from '@/trading/features/portfolio/types'
import type { Caveat, EvidenceReduceReasonCode } from '@/trading/kernel/caveat'
import type { MarketRef, PortfolioSegment } from '@/trading/kernel/instrument'
import type { RegimeScale } from '@/trading/kernel/market/market-data'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import { DISTRIBUTION_EPSILON, distribute } from '@/trading/features/portfolio/folds/distribution'
import {
  capTrims,
  compareCandidates,
  coreOf,
  driftBand,
  etfCeilingPctNav,
  isWeakHolding,
  turnoverCapPctNav,
} from '@/trading/features/portfolio/folds/policy'
import { buildInstrumentKey, CASH_SEGMENT, ETF_KIND } from '@/trading/kernel/instrument'
import { positionCapOf } from '@/trading/kernel/operator/profile'

export interface AdviceInput {
  readonly profile: UserProfile
  readonly valued: ValuedBook
  readonly assessment: PortfolioAssessment
  readonly candidates: readonly PortfolioCandidate[]
  readonly rebalancePolicy: RebalancePolicy
  /** The macro ceiling on deployment, per segment. Clamped to at most 1 before use: macro may reduce
   *  deployment, never license more risk. */
  readonly regimes: ReadonlyMap<PortfolioSegment, RegimeScale>
  /** Per held instrument, keyed by `buildInstrumentKey`, in [-1, 1]. Absent means no opinion, not 0. */
  readonly holdingSignals?: ReadonlyMap<string, number>
  /** Held names the newest verdict says to sell on evidence, keyed by `buildInstrumentKey`. A name
   *  here takes no increase, however far under target it sits. Required, not optional: an omitted
   *  map would open every name a verdict had closed, and silently. */
  readonly standingReduces: ReadonlyMap<string, EvidenceReduceReasonCode>
  /** Available cash each market's tradable venues hold, keyed by market. A segment whose market is
   *  absent here is one the operator trades by hand, so its budget is not bounded by cash at all. */
  readonly reachableCashBase: ReadonlyMap<MarketRef, number>
  /** False when no profile has been stored, so `profile` is the seeded default. */
  readonly profileSaved: boolean
}

export interface DesiredWeights {
  /** Desired portfolio weight per candidate, keyed by `buildInstrumentKey`. */
  readonly byInstrument: ReadonlyMap<string, number>
  readonly caveats: readonly Caveat[]
  /** Each segment's core tracker, by instrument key. */
  readonly cores: ReadonlySet<string>
  /** Held names past their own cap or their sector's: `byInstrument` already carries the trimmed weight. */
  readonly capTrims: ReadonlyMap<string, CapTrim>
}

// why-safe: the record is keyed by PortfolioSegment; Object.entries widens the key to string.
export function segmentEntries(
  record: Readonly<Record<PortfolioSegment, number>>
): readonly (readonly [PortfolioSegment, number])[] {
  return Object.entries(record) as unknown as (readonly [PortfolioSegment, number])[]
}

export function currentSegmentWeights(valued: ValuedBook): ReadonlyMap<PortfolioSegment, number> {
  return new Map(valued.segmentValues.map((value) => [value.segment, value.weightPctNav]))
}

export function currentPositionWeights(
  valued: ValuedBook,
  nav: number
): ReadonlyMap<string, number> {
  const weights = new Map<string, number>()

  for (const entry of valued.positions) {
    if (entry.kind === 'priced') {
      weights.set(buildInstrumentKey(entry.position.instrument), entry.valueBase / nav)
    }
  }

  return weights
}

/** One row per profile target, drifted or not: allocation answers "where should the portfolio be
 *  and where does today's plan leave it", rebalance answers "what changes today". */
export function allocationRows(
  input: AdviceInput,
  plan: readonly PositionChange[]
): readonly SegmentTarget[] {
  const current = currentSegmentWeights(input.valued)
  const planned = plannedDeltas(plan)

  return segmentEntries(input.profile.segmentTargets)
    .map(([segment, targetPctNav]) => {
      const currentPctNav = current.get(segment) ?? 0

      return {
        kind: 'segment-target' as const,
        segment,
        currentPctNav,
        targetPctNav,
        afterPlanPctNav: currentPctNav + (planned.get(segment) ?? 0),
        driftBandPctNav: driftBand(targetPctNav, input.rebalancePolicy),
        // Cash seeds no cap, so the lookup is what omits it — no branch on the segment id needed.
        ...capOf(input.profile, segment),
        ...etfOf(input, segment),
      }
    })
    .sort((left, right) => left.segment.localeCompare(right.segment))
}

function capOf(profile: UserProfile, segment: PortfolioSegment): { readonly capPctNav?: number } {
  const cap = profile.caps[segment]?.maximumSegmentPctNav

  return cap === undefined ? {} : { capPctNav: cap }
}

/** The segment's ETF holding and its ceiling travel together or not at all: a ceiling with no
 *  reading cannot be placed, and a reading under no ceiling bounds nothing. */
function etfOf(
  input: AdviceInput,
  segment: PortfolioSegment
): { readonly etfPctNav?: number; readonly etfCapPctNav?: number } {
  const cap = input.profile.caps[segment]?.maximumEtfPctNav
  const held = input.valued.segmentValues.find((value) => value.segment === segment)?.etfPctNav

  return cap === undefined || held === undefined ? {} : { etfPctNav: held, etfCapPctNav: cap }
}

/** Cash funds every purchase and receives every sale, so its own move is the negative of what the
 *  rest of the plan spends. */
function plannedDeltas(plan: readonly PositionChange[]): ReadonlyMap<PortfolioSegment, number> {
  const deltas = new Map<PortfolioSegment, number>()
  let spent = 0

  for (const row of plan) {
    deltas.set(row.segment, (deltas.get(row.segment) ?? 0) + row.changePctNav)
    spent += row.changePctNav
  }

  deltas.set(CASH_SEGMENT, -spent)

  return deltas
}

/** Each investable segment's target is split proportional to positive market score, clamped by
 *  every applicable cap, and the overflow redistributed among uncapped candidates. Held names in
 *  the zone between a positive read and the weak-holding line keep their current weight first,
 *  except what a segment held past its target has to give back. */
export function desiredWeights(input: AdviceInput, nav: number): DesiredWeights {
  const byInstrument = new Map<string, number>()
  const caveats: Caveat[] = []
  const cores = new Set<string>()
  const excluded = new Set(input.profile.exclusions.map(buildInstrumentKey))
  const current = currentPositionWeights(input.valued, nav)
  const trims = capTrims({ ...input, held: current })
  const held = new Map(
    [...current].map(([key, weight]) => [key, trims.get(key)?.toPctNav ?? weight])
  )
  // Sector room is portfolio-wide, so one tracker spans every segment.
  const rooms = createRoomTracker(input)

  for (const [segment, target] of segmentEntries(input.profile.segmentTargets)) {
    if (segment === CASH_SEGMENT || target <= 0) {
      continue
    }

    const weights = weighSegment({ input, nav, segment, target, held, excluded, rooms })

    for (const [key, weight] of weights.byInstrument) {
      byInstrument.set(key, weight)
    }

    caveats.push(...weights.caveats)

    for (const key of weights.cores) {
      cores.add(key)
    }
  }

  return { byInstrument, caveats, cores, capTrims: trims }
}

interface WeighSegmentInput {
  readonly input: AdviceInput
  readonly nav: number
  readonly segment: PortfolioSegment
  readonly target: number
  readonly held: ReadonlyMap<string, number>
  readonly excluded: ReadonlySet<string>
  readonly rooms: RoomTracker
}

/** One segment's target split: the core and the held names it must reserve, then the score
 *  distribution over whatever target is left. */
function weighSegment(request: WeighSegmentInput): Omit<DesiredWeights, 'capTrims'> {
  const { input, segment, target, excluded, rooms } = request
  const byInstrument = new Map<string, number>()
  const caveats: Caveat[] = []
  const named = input.candidates.filter((candidate) => candidate.segment === segment)
  const caps = input.profile.caps[segment]
  const core = coreOf(caps, named, request.held)

  if (core === undefined && (caps?.minimumEtfPctNav ?? 0) > 0) {
    caveats.push({ code: 'portfolio.core-unfilled', detail: { segment } })
  }

  const kept = keptHoldings(named, {
    held: request.held,
    excluded,
    target,
    ...(core === undefined ? {} : { core }),
  })
  const reserved = new Set<string>()
  let unreserved = target

  for (const [candidate, weight] of kept) {
    const key = buildInstrumentKey(candidate.instrument)

    byInstrument.set(key, weight)
    reserved.add(key)
    rooms.record(candidate, weight)
    unreserved -= weight
  }

  const openTarget = Math.max(0, unreserved)

  // A reserved name is out of the distribution, not merely ahead of it. Until the core, every kept
  // name scored at or below zero and so failed the score filter anyway; a core tracker that scores
  // well would otherwise be assigned a second weight that overwrites its floor.
  const eligible = named
    .filter((candidate) => candidate.marketScore > 0)
    .filter((candidate) => !reserved.has(buildInstrumentKey(candidate.instrument)))
    .filter((candidate) => !excluded.has(buildInstrumentKey(candidate.instrument)))
    .sort(compareCandidates)
  const distributed = distribute(eligible, openTarget, {
    ceilingFor: ceilingsFor(input, request.nav, rooms),
    onAssign: (candidate, delta) => rooms.record(candidate, delta),
  })

  for (const [key, weight] of distributed.weights) {
    byInstrument.set(key, weight)
  }

  if (distributed.residue > DISTRIBUTION_EPSILON) {
    caveats.push(residueCaveat({ segment, openTarget, eligible, bind: distributed.bind }, input))
  }

  return { byInstrument, caveats, cores: new Set(core === undefined ? [] : [core[0]]) }
}

interface HoldingContext {
  readonly held: ReadonlyMap<string, number>
  readonly excluded: ReadonlySet<string>
  readonly target: number
  /** The segment's core: its tracker's instrument key, and the weight that tracker is owed. */
  readonly core?: readonly [string, number]
}

/** Held, unfunded, and not being exited either: entry needs a positive read while exit waits for
 *  the weak-holding line, and an excluded name was declined, never asked to be sold. Their weight
 *  is reserved rather than skipped, or the segment would buy past its target on top of it. The core
 *  reserves at its floor whatever its score says, which is the whole of what a core means. */
function keptHoldings(
  candidates: readonly PortfolioCandidate[],
  context: HoldingContext
): readonly (readonly [PortfolioCandidate, number])[] {
  const kept: (readonly [PortfolioCandidate, number])[] = []
  const cuts = neutralCuts(candidates, context)

  for (const candidate of candidates) {
    const key = buildInstrumentKey(candidate.instrument)
    const weight = heldWeightOf(context, candidate)
    const spared = context.excluded.has(key) || isNeutralRead(candidate)
    const reserved = Math.max(coreFloorOf(context, key), spared ? weight - (cuts.get(key) ?? 0) : 0)

    if (reserved > 0) {
      kept.push([candidate, reserved])
    }
  }

  return kept
}

/** Between a positive read and the weak-holding line: not bought, not exited. A fund has no such
 *  line, so any read at or below zero keeps it. */
function isNeutralRead(candidate: PortfolioCandidate): boolean {
  return (
    candidate.marketScore <= 0 && !isWeakHolding(candidate.marketScore, candidate.instrumentKind)
  )
}

function heldWeightOf(context: HoldingContext, candidate: PortfolioCandidate): number {
  return context.held.get(buildInstrumentKey(candidate.instrument)) ?? 0
}

function coreFloorOf(context: HoldingContext, key: string): number {
  return context.core?.[0] === key ? context.core[1] : 0
}

/** A segment held past its target gives the overshoot back from its neutral names, weakest first.
 *  Reserving them whole left the whole trim to the names the score still rates positive, which
 *  sells what the evidence likes to keep what it does not. An excluded name and the core's floor
 *  are never cut. */
function neutralCuts(
  candidates: readonly PortfolioCandidate[],
  context: HoldingContext
): ReadonlyMap<string, number> {
  const cuts = new Map<string, number>()
  let overshoot =
    candidates.reduce((sum, candidate) => sum + heldWeightOf(context, candidate), 0) -
    context.target
  const weakestFirst = candidates.filter(isNeutralRead).sort(compareCandidates).reverse()

  for (const candidate of weakestFirst) {
    const key = buildInstrumentKey(candidate.instrument)

    if (overshoot <= 0) {
      break
    }

    if (!context.excluded.has(key)) {
      const cuttable = Math.max(0, heldWeightOf(context, candidate) - coreFloorOf(context, key))
      const cut = Math.min(cuttable, overshoot)

      cuts.set(key, cut)
      overshoot -= cut
    }
  }

  return cuts
}

// Two causes, two different fixes: an empty candidate set is answered by naming a name, a set that
// filled every ceiling by raising a cap. One message for both would send the reader to the wrong one.
function residueCaveat(
  input: {
    readonly segment: PortfolioSegment
    /** What the score distribution had left to place, after every reserved holding took its weight. */
    readonly openTarget: number
    readonly eligible: readonly PortfolioCandidate[]
    readonly bind: CapBind | null
  },
  advice: Pick<AdviceInput, 'standingReduces'>
): Caveat {
  const { segment, bind } = input
  // A name the evidence closed keeps its weight but takes no buy, so it is not one to count.
  const eligibleCount = input.eligible.filter(
    (candidate) => !advice.standingReduces.has(buildInstrumentKey(candidate.instrument))
  ).length

  if (eligibleCount === 0) {
    return { code: 'portfolio.segment-no-candidates', detail: { segment } }
  }

  // An unbound residue means the pass ran out of receivers rather than filling one, which names no
  // cap the operator could raise.
  if (bind === null) {
    return { code: 'portfolio.targets-unfilled', detail: { segment } }
  }

  // A pool too small to reach the target at any per-name weight is not a cap that is too tight, and
  // telling the operator to raise one sends them to the wrong fix.
  const reachable = eligibleCount * bind.capPctNav

  if (reachable < input.openTarget) {
    return {
      code: 'portfolio.too-few-candidates',
      detail: {
        segment,
        count: eligibleCount,
        needed: Math.ceil(input.openTarget / bind.capPctNav),
        cap: bind.capPctNav,
      },
    }
  }

  return {
    code: 'portfolio.targets-renormalized',
    detail: { segment, limit: bind.reason, cap: bind.capPctNav },
  }
}

interface RoomTracker {
  roomFor(candidate: PortfolioCandidate, current: number): number
  etfRoomFor(candidate: PortfolioCandidate, current: number): number
  record(candidate: PortfolioCandidate, delta: number): void
}

// Sector and ETF totals less the holding, plus this candidate's own share; weights here are absolute
// targets, so a held fund is already in the ETF total. A sectorless name is unbounded here and left
// to its segment target.
function createRoomTracker(input: AdviceInput): RoomTracker {
  const { profile } = input
  const sectorUsed = new Map<string, number>()
  const etfUsed = new Map<PortfolioSegment, number>()
  const segments = new Map(input.valued.segmentValues.map((value) => [value.segment, value]))

  return {
    roomFor(candidate, current) {
      return candidate.sector === undefined
        ? Number.POSITIVE_INFINITY
        : profile.maximumSectorPctNav - (sectorUsed.get(candidate.sector) ?? 0) + current
    },

    etfRoomFor(candidate, current) {
      if (candidate.instrumentKind !== ETF_KIND) {
        return Number.POSITIVE_INFINITY
      }

      const ceiling = etfCeilingPctNav(
        profile.caps[candidate.segment],
        segments.get(candidate.segment)
      )

      return ceiling - (etfUsed.get(candidate.segment) ?? 0) + current
    },

    record(candidate, delta) {
      if (candidate.sector !== undefined) {
        sectorUsed.set(candidate.sector, (sectorUsed.get(candidate.sector) ?? 0) + delta)
      }

      if (candidate.instrumentKind === ETF_KIND) {
        etfUsed.set(candidate.segment, (etfUsed.get(candidate.segment) ?? 0) + delta)
      }
    },
  }
}

// The tightest of position, market, liquidity, sector, and ETF room.
function ceilingsFor(input: AdviceInput, nav: number, rooms: RoomTracker): CeilingFor {
  return (candidate, current) => {
    const limits: readonly Ceiling[] = [
      {
        reason: 'position',
        // Fail closed: a segment with no recorded cap sizes to zero here, matching candidates.ts'
        // `capFor` default — a suggestion engine that cannot see a limit must not act as if none
        // applies.
        value: positionCapOf(input.profile.caps[candidate.segment], candidate.instrumentKind),
      },
      { reason: 'market', value: candidate.maximumPositionPctNav },
      { reason: 'liquidity', value: turnoverCapPctNav(candidate.averageDailyTurnoverBase, nav) },
      { reason: 'sector', value: rooms.roomFor(candidate, current) },
      { reason: 'etf', value: rooms.etfRoomFor(candidate, current) },
    ]
    const tightest = limits.reduce((best, limit) => (limit.value < best.value ? limit : best))

    return { value: Math.max(0, tightest.value), reason: tightest.reason }
  }
}
