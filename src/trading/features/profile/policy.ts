import type { CurrencyCode, PortfolioSegment, PositionCategory } from '@/trading/kernel/instrument'
import type {
  InvestmentHorizon,
  ProfilePolicyNumbers,
  RiskCapSet,
  RiskLevel,
  UserProfile,
} from '@/trading/kernel/operator/profile'
import { ValidationError } from '@/core/errors'
import { CASH_SEGMENT, POSITION_CATEGORIES, portfolioSegment } from '@/trading/kernel/instrument'
import { DISABLED_CAPS } from '@/trading/kernel/operator/profile'

// The seed derivation divides, so targets sum to one only within a tolerance.
export const TARGET_SUM_EPSILON = 1e-9

export const WATCHLIST_MAXIMUM_ENTRIES = 100
export const EXCLUSION_MAXIMUM_ENTRIES = 100

export interface SegmentDescriptor {
  readonly id: PortfolioSegment
  readonly category: PositionCategory
  readonly seedsDefaultTarget: boolean
  /** Whether any venue holds this market. One no venue holds is a reference read (world gold, which
   *  domestic gold prices against): its segment stays off, because nothing could fill it. */
  readonly held: boolean
  /** Share of the category's allocation relative to its siblings; one is an even split. */
  readonly seedWeight: number
  readonly holdsEtfs: boolean
  readonly horizon: InvestmentHorizon
}

const SEGMENT_CEILING_FLOOR_PCT_POINTS = 0.05

const SEGMENT_CEILING_RELATIVE_FRACTION = 0.25

/** A segment that declares no weight takes an even share of its category. */
export const DEFAULT_SEED_WEIGHT = 1

const DEFAULT_RISK_LEVEL: RiskLevel = 'balanced'
const DEFAULT_GOAL = 'grow'

/** Share of a sized position the first order takes; the rest waits for the retest to hold. */
const DEFAULT_ENTRY_TRANCHE_FRACTION = 0.5
/** Share of a position the first target closes; the rest is held with the trend. */
const DEFAULT_TAKE_PROFIT_TRANCHE_FRACTION = 1 / 3

export interface PolicyBound {
  readonly minimum: number
  readonly maximum: number
}

export interface ProfileBounds {
  readonly positionPctNavByCategory: Readonly<Partial<Record<PositionCategory, PolicyBound>>>
  /** How far a segment's own ceiling may be set. A seeded ceiling follows its target and needs no
   *  bound; `profile_update` writes the whole caps record on an agent's word, and nothing else
   *  stops one segment being opened to the entire book. */
  readonly segmentPctNavByCategory: Readonly<Partial<Record<PositionCategory, PolicyBound>>>
  readonly maximumSectorPctNav: PolicyBound
  readonly reservePctNav: PolicyBound
  readonly regimeScale: PolicyBound
  readonly riskPerTradePctNav: PolicyBound
  readonly maximumOpenRiskPctNav: PolicyBound
  readonly entryTranchePct: PolicyBound
  readonly takeProfitTranchePct: PolicyBound
}

interface RiskRow {
  readonly stock: number
  readonly gold: number
  readonly crypto: number
  readonly cash: number
  readonly stockPositionCapPctNav: number
  readonly maximumEtfPctNav: number
  readonly maximumSectorPctNav: number
  readonly reservePctNav: number
  readonly regimeScale: number
  readonly riskPerTradePctNav: number
  readonly maximumOpenRiskPctNav: number
}

/** A tracker correlates near-1 with its segment, so the aggressive book — the one most concentrated
 *  in single names — gets the smallest tracker allowance, not the largest. There is no `etf` target:
 *  no segment declares category `etf`, so ETF exposure lives only in the `maximumEtfPctNav` sub-cap
 *  on segments that hold ETFs. Allowances fall with risk appetite: 0.35/0.25/0.15. */
const RISK_TABLE: Readonly<Record<RiskLevel, RiskRow>> = Object.freeze({
  conservative: {
    stock: 0.25,
    gold: 0.15,
    crypto: 0,
    cash: 0.25,
    stockPositionCapPctNav: 0.08,
    maximumEtfPctNav: 0.35,
    maximumSectorPctNav: 0.25,
    reservePctNav: 0.35,
    regimeScale: 0.75,
    riskPerTradePctNav: 0.01,
    maximumOpenRiskPctNav: 0.04,
  },
  balanced: {
    stock: 0.4,
    gold: 0.1,
    crypto: 0.05,
    cash: 0.2,
    stockPositionCapPctNav: 0.1,
    maximumEtfPctNav: 0.25,
    maximumSectorPctNav: 0.3,
    reservePctNav: 0.2,
    regimeScale: 1,
    riskPerTradePctNav: 0.015,
    maximumOpenRiskPctNav: 0.06,
  },
  aggressive: {
    stock: 0.55,
    gold: 0.05,
    crypto: 0.1,
    cash: 0.15,
    stockPositionCapPctNav: 0.15,
    maximumEtfPctNav: 0.15,
    maximumSectorPctNav: 0.4,
    reservePctNav: 0.1,
    regimeScale: 1,
    riskPerTradePctNav: 0.02,
    maximumOpenRiskPctNav: 0.08,
  },
})

const POSITION_CAP_OVERRIDES: Readonly<Partial<Record<PositionCategory, number>>> = Object.freeze({
  etf: 0.3,
  gold: 0.25,
  crypto: 0.05,
})

// Keyed by category, so a new market declaring `segmentCategory: 'stock'` inherits stock bounds.
export const PROFILE_BOUNDS: ProfileBounds = Object.freeze({
  positionPctNavByCategory: Object.freeze({
    stock: { minimum: 0.03, maximum: 0.25 },
    etf: { minimum: 0.05, maximum: 0.4 },
    gold: { minimum: 0.05, maximum: 0.4 },
    crypto: { minimum: 0.01, maximum: 0.2 },
  }),
  // The floor is the seeded ceiling's own floor, so every seed clears it. A seeded ceiling is clamped
  // to the maximum: one segment left on takes the others' share, and its ceiling would pass it.
  segmentPctNavByCategory: Object.freeze({
    stock: { minimum: SEGMENT_CEILING_FLOOR_PCT_POINTS, maximum: 0.9 },
    gold: { minimum: SEGMENT_CEILING_FLOOR_PCT_POINTS, maximum: 0.5 },
    crypto: { minimum: SEGMENT_CEILING_FLOOR_PCT_POINTS, maximum: 0.3 },
  }),
  maximumSectorPctNav: { minimum: 0.1, maximum: 0.6 },
  reservePctNav: { minimum: 0.05, maximum: 0.6 },
  regimeScale: { minimum: 0.5, maximum: 1 },
  riskPerTradePctNav: { minimum: 0.005, maximum: 0.03 },
  maximumOpenRiskPctNav: { minimum: 0.02, maximum: 0.15 },
  // Below a fifth, the first buy or the first sale is too small to change the position it belongs to.
  entryTranchePct: { minimum: 0.2, maximum: 1 },
  takeProfitTranchePct: { minimum: 0.2, maximum: 1 },
})

/** The two records that only ever move together: a segment's target and the ceiling above it. */
interface SegmentPolicy {
  readonly segmentTargets: Readonly<Record<PortfolioSegment, number>>
  readonly caps: Readonly<Record<PortfolioSegment, RiskCapSet>>
}

function resolveSeedPolicy(
  level: RiskLevel,
  segments: readonly SegmentDescriptor[]
): SegmentPolicy {
  const segmentTargets = seedTargets(level, segments)

  return { segmentTargets, caps: seedCaps(level, segmentTargets, segments) }
}

interface DefaultProfileOptions {
  readonly baseCurrency: CurrencyCode
  readonly segments: readonly SegmentDescriptor[]
  readonly riskLevel?: RiskLevel
}

/** The only builder of an absent or reset profile. Capacity and willingness both start at the seed
 *  level, so a fresh profile's effective risk is that level by construction. */
export function defaultProfile(options: DefaultProfileOptions): UserProfile {
  const level = options.riskLevel ?? DEFAULT_RISK_LEVEL
  const seed = resolveSeedPolicy(level, options.segments)

  return {
    ...seededPolicyNumbers(level),
    baseCurrency: options.baseCurrency,
    riskLevel: level,
    riskCapacity: level,
    riskWillingness: level,
    horizons: seedHorizons(options.segments),
    goal: DEFAULT_GOAL,
    watchlist: [],
    exclusions: [],
    segmentTargets: seed.segmentTargets,
    pinnedTargets: {},
    etfCores: {},
    caps: seed.caps,
  }
}

/** One owner for two readers: a fresh profile is seeded from these, and the store fills a stored
 *  profile's absent number from the same place. */
export function seededPolicyNumbers(riskLevel: RiskLevel): ProfilePolicyNumbers {
  const row = RISK_TABLE[riskLevel]

  return {
    maximumSectorPctNav: row.maximumSectorPctNav,
    reservePctNav: row.reservePctNav,
    regimeScale: row.regimeScale,
    riskPerTradePctNav: row.riskPerTradePctNav,
    maximumOpenRiskPctNav: row.maximumOpenRiskPctNav,
    entryTranchePct: DEFAULT_ENTRY_TRANCHE_FRACTION,
    takeProfitTranchePct: DEFAULT_TAKE_PROFIT_TRANCHE_FRACTION,
  }
}

function seedHorizons(
  segments: readonly SegmentDescriptor[]
): Readonly<Record<PortfolioSegment, InvestmentHorizon>> {
  return Object.fromEntries(segments.map((segment) => [segment.id, segment.horizon]))
}

function seedTargets(
  level: RiskLevel,
  segments: readonly SegmentDescriptor[]
): Readonly<Record<PortfolioSegment, number>> {
  const row = RISK_TABLE[level]
  const targets: Record<PortfolioSegment, number> = { [CASH_SEGMENT]: row.cash }

  for (const category of POSITION_CATEGORIES) {
    // No segment declares category `etf`; its row would have no segment to land on.
    if (category === 'etf') {
      continue
    }

    const inCategory = segments.filter((segment) => segment.category === category)
    const seeded = inCategory.filter((segment) => segment.seedsDefaultTarget)
    const weight = seeded.reduce((total, segment) => total + segment.seedWeight, 0)

    for (const segment of inCategory) {
      const share = weight === 0 ? 0 : (row[category] * segment.seedWeight) / weight

      targets[segment.id] = segment.seedsDefaultTarget ? share : 0
    }
  }

  return renormalize(targets)
}

function renormalize(targets: Record<PortfolioSegment, number>): Record<PortfolioSegment, number> {
  const total = Object.values(targets).reduce((sum, value) => sum + value, 0)

  if (total <= 0) {
    throw new ValidationError('segment targets sum to zero')
  }

  return Object.fromEntries(
    Object.entries(targets).map(([segment, weight]) => [segment, weight / total])
  )
}

function seedCaps(
  level: RiskLevel,
  targets: Readonly<Record<PortfolioSegment, number>>,
  segments: readonly SegmentDescriptor[]
): Readonly<Record<PortfolioSegment, RiskCapSet>> {
  const row = RISK_TABLE[level]

  return Object.fromEntries(
    segments.map((segment) => {
      // A segment that seeds no target seeds no room either: the ceiling floor would otherwise hand
      // it a buyable cap the seeded allocation never asked for.
      if (!segment.seedsDefaultTarget) {
        return [segment.id, DISABLED_CAPS]
      }

      const ceiling = segmentCeiling(
        targets[segment.id] ?? 0,
        PROFILE_BOUNDS.segmentPctNavByCategory[segment.category]
      )
      const flatCap = POSITION_CAP_OVERRIDES[segment.category] ?? row.stockPositionCapPctNav

      return [
        segment.id,
        {
          // Patch validation rejects a position cap above its segment ceiling; seeds obey it too.
          maximumPositionPctNav: Math.min(flatCap, ceiling),
          maximumSegmentPctNav: ceiling,
          ...(segment.holdsEtfs
            ? { maximumEtfPctNav: Math.min(row.maximumEtfPctNav, ceiling) }
            : {}),
        },
      ]
    })
  )
}

interface PinnedTargetsInput {
  readonly segmentTargets: Readonly<Record<PortfolioSegment, number>>
  readonly caps: Readonly<Record<PortfolioSegment, RiskCapSet>>
  readonly pinned: Readonly<Partial<Record<PortfolioSegment, number>>>
  readonly reservePctNav: number
  readonly segments: readonly SegmentDescriptor[]
  readonly bounds: ProfileBounds
}

/** The hand-set targets laid over a set of seeded ones: each pin keeps its exact number and every
 *  other segment keeps its share of what is left, so the set still sums to one. Cash is not in the
 *  pool and never sits below the reserve - it is what the operator chose to keep, not slack for a
 *  pin to spend - and pins that would eat into it are refused rather than shaved. */
export function applyPinnedTargets(input: PinnedTargetsInput): SegmentPolicy {
  if (Object.keys(input.pinned).length === 0 && !isBelowReserve(input)) {
    return { segmentTargets: input.segmentTargets, caps: input.caps }
  }

  const segmentTargets = pinnedTargets(input)

  return { segmentTargets, caps: widenedCaps(input, segmentTargets) }
}

function pinnedTargets(input: PinnedTargetsInput): Record<PortfolioSegment, number> {
  const { pinned, segmentTargets } = input
  const cash = Math.max(segmentTargets[CASH_SEGMENT] ?? 0, input.reservePctNav)
  const others = Object.entries(segmentTargets).filter(
    ([id]) => id !== CASH_SEGMENT && pinned[portfolioSegment(id)] === undefined
  )
  const othersTotal = others.reduce((total, [, weight]) => total + weight, 0)
  const pinnedTotal = Object.values(pinned).reduce<number>(
    (total, weight) => total + (weight ?? 0),
    0
  )
  const remainder = 1 - pinnedTotal - cash

  if (remainder < -TARGET_SUM_EPSILON) {
    throw new ValidationError('pinned targets leave less than the cash reserve', {
      key: 'errors.profilePinsOverReserve',
    })
  }

  if (othersTotal <= 0 && remainder > TARGET_SUM_EPSILON) {
    throw new ValidationError('no other segment can absorb the pinned targets', {
      key: 'errors.profilePinsNoAbsorber',
    })
  }

  // Float residue inside the epsilon must not leave another segment a negative weight.
  const scale = othersTotal > 0 ? Math.max(remainder, 0) / othersTotal : 0

  return {
    ...Object.fromEntries(others.map(([id, weight]) => [id, weight * scale])),
    ...pinned,
    [CASH_SEGMENT]: cash,
  }
}

/** The cash target under the reserve, the one state a profile edit must lift before it is stored. */
export function isBelowReserve(
  input: Pick<PinnedTargetsInput, 'segmentTargets' | 'reservePctNav'>
): boolean {
  return (input.segmentTargets[CASH_SEGMENT] ?? 0) < input.reservePctNav - TARGET_SUM_EPSILON
}

function widenedCaps(
  input: PinnedTargetsInput,
  targets: Readonly<Record<PortfolioSegment, number>>
): Record<PortfolioSegment, RiskCapSet> {
  return Object.fromEntries(
    input.segments.map((descriptor) => [
      descriptor.id,
      widenedCap(
        input.caps[descriptor.id] ?? DISABLED_CAPS,
        targets[descriptor.id] ?? 0,
        input.bounds.segmentPctNavByCategory[descriptor.category]
      ),
    ])
  )
}

/** A ceiling the new target outgrew is raised to what that target seeds, clamped to what the
 *  category admits. Every other ceiling is left exactly as it stands: a pin moves the allocation,
 *  and a cap the operator set by hand is not collateral. */
function widenedCap(cap: RiskCapSet, target: number, bound: PolicyBound | undefined): RiskCapSet {
  if (cap.maximumSegmentPctNav >= target) {
    return cap
  }

  return { ...cap, maximumSegmentPctNav: segmentCeiling(target, bound) }
}

function segmentCeiling(target: number, bound: PolicyBound | undefined): number {
  const ceiling =
    target + Math.max(SEGMENT_CEILING_FLOOR_PCT_POINTS, target * SEGMENT_CEILING_RELATIVE_FRACTION)

  return bound === undefined ? ceiling : Math.min(ceiling, bound.maximum)
}
