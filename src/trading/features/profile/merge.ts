import type { ProfileContext } from '@/trading/features/profile/types'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import type {
  InvestmentHorizon,
  ProfilePatch,
  RiskCapSet,
  RiskLevel,
  UserProfile,
} from '@/trading/kernel/operator/profile'
import {
  applyPinnedTargets,
  defaultProfile,
  TARGET_SUM_EPSILON,
} from '@/trading/features/profile/policy'
import { assertPatch } from '@/trading/features/profile/validate'
import { portfolioSegment } from '@/trading/kernel/instrument'
import { disabledSegments, isSegmentDisabled, RISK_LEVELS } from '@/trading/kernel/operator/profile'

type EtfCores = UserProfile['etfCores']

/** Never stored, always derived: someone willing to take risk they cannot afford is limited by
 *  what they can afford. */
function effectiveRisk(capacity: RiskLevel, willingness: RiskLevel): RiskLevel {
  // The fallback covers corrupted persisted data only; both well-typed levels index RISK_LEVELS.
  return (
    RISK_LEVELS[Math.min(RISK_LEVELS.indexOf(capacity), RISK_LEVELS.indexOf(willingness))] ??
    'conservative'
  )
}

// The only merge/validation owner. A direct riskLevel sets both split fields.
export function updateProfile(
  current: UserProfile,
  patch: ProfilePatch,
  context: ProfileContext
): UserProfile {
  const capacity = patch.riskLevel ?? patch.riskCapacity ?? current.riskCapacity
  const willingness = patch.riskLevel ?? patch.riskWillingness ?? current.riskWillingness
  const riskLevel = effectiveRisk(capacity, willingness)
  const effective = withAgreeingPins(
    current,
    {
      ...resolveRiskPolicy(current, context, riskLevel),
      ...patch,
    },
    patch
  )

  const etfCores = askedEtfCores(current, patch, effective)

  assertPatch(current, effective, context)

  return {
    ...current,
    ...applyOptional(effective),
    etfCores,
    caps: heldEtfCores(effective.caps ?? current.caps, etfCores),
    horizons: mergeHorizons(current.horizons, effective.horizons),
    riskCapacity: capacity,
    riskWillingness: willingness,
    riskLevel,
    // The first persisted profile fixes the currency, so a later config change cannot reinterpret
    // historical facts. ProfilePatch has no field for it.
    baseCurrency: current.baseCurrency,
  }
}

/** New targets named without their pins leave every stored pin that disagrees with them behind, and
 *  a later `/profile set segment-target` or level change would re-apply it over the edit. A pin the
 *  new targets still honour stays. */
function withAgreeingPins(
  current: UserProfile,
  effective: ProfilePatch,
  patch: ProfilePatch
): ProfilePatch {
  const { segmentTargets } = effective

  if (segmentTargets === undefined || patch.pinnedTargets !== undefined) {
    return effective
  }

  const pinned = Object.entries(effective.pinnedTargets ?? current.pinnedTargets).filter(
    ([segment, weight]) =>
      Math.abs((segmentTargets[portfolioSegment(segment)] ?? 0) - (weight ?? 0)) <=
      TARGET_SUM_EPSILON
  )

  return { ...effective, pinnedTargets: Object.fromEntries(pinned) }
}

/** Rebuilds today's defaults through the same validator a hand-written patch crosses, so a seed
 *  that violates current bounds fails loudly instead of being persisted. Base currency, locale and
 *  the caller's risk level survive: raising every cap under a command that reads as tidying up is
 *  not a reset. Moving the level is `updateProfile`'s job, and it re-seeds the same numbers.
 *
 *  The watchlist and the exclusions survive too. They are curated lists with their own owner
 *  (`/watchlist`), not risk policy, and destroying them under a command whose stated subject is the
 *  investor profile is a trap: nothing here can put them back. */
export function resetProfile(
  current: UserProfile,
  context: ProfileContext,
  riskLevel: RiskLevel
): UserProfile {
  const seeded = defaultProfile({
    preferredLocale: current.preferredLocale,
    baseCurrency: current.baseCurrency,
    segments: context.segments,
    riskLevel,
  })

  return updateProfile(
    current,
    {
      ...toRiskPolicyPatch(seeded),
      riskLevel: seeded.riskLevel,
      horizons: seeded.horizons,
      goal: seeded.goal,
    },
    context
  )
}

/** A patch that moves the risk level without naming the numbers it implies re-seeds them, so a
 *  first-time operator answering "conservative" is not left sized as balanced under a conservative
 *  label. A number the patch names still wins. A sleeve the operator switched off stays off: the
 *  level says how much risk they want, not which markets they will hold, and re-seeding a closed
 *  sleeve would put one back in front of them under a command that never mentioned it. `/profile
 *  reset` names the caps outright, so it still re-enables. */
function resolveRiskPolicy(
  current: UserProfile,
  context: ProfileContext,
  riskLevel: RiskLevel
): ProfilePatch {
  if (riskLevel === current.riskLevel) {
    return {}
  }

  return toRiskPolicyPatch(
    seedRiskPolicy({ current, context, riskLevel, off: offSegments(current, context) })
  )
}

interface SeedRiskPolicyOptions {
  readonly current: UserProfile
  readonly context: ProfileContext
  readonly riskLevel: RiskLevel
  readonly off: ReadonlySet<PortfolioSegment>
}

/** Today's numbers at a risk level with some sleeves off, built the way a fresh profile is when
 *  those sleeves never seed: their weight spreads across the rest, and every open sleeve's caps
 *  follow its target. A toggle and a level change both read this, so a book with gold off looks
 *  the same whichever command closed it.
 *
 *  `off` overrides the manifest's `seedsDefaultTarget`, which answers only what a first-ever
 *  profile holds. Once one is stored, its caps are the standing answer, and a sleeve the operator
 *  switched on must seed a target however its market shipped. */
export function seedRiskPolicy(options: SeedRiskPolicyOptions): UserProfile {
  const seeded = defaultProfile({
    preferredLocale: options.current.preferredLocale,
    baseCurrency: options.current.baseCurrency,
    segments: options.context.segments.map((descriptor) => ({
      ...descriptor,
      seedsDefaultTarget: descriptor.held && !options.off.has(descriptor.id),
    })),
    riskLevel: options.riskLevel,
  })
  // A pin on a sleeve this seeding closes is dropped: a target for a sleeve nothing may hold is a
  // number no later re-seed could satisfy.
  const pinned = openPins(options.current.pinnedTargets, options.off)
  const retargeted = { ...seeded, ...applyPinnedTargets({ ...seeded, pinned, ...options.context }) }

  return { ...retargeted, pinnedTargets: pinned, etfCores: options.current.etfCores }
}

/** Caps the operator wrote state their core, unless the sleeve is off or the core only repeats the
 *  held one: a clamped value is not what they asked for. */
function askedEtfCores(
  current: UserProfile,
  patch: ProfilePatch,
  effective: ProfilePatch
): EtfCores {
  if (patch.etfCores !== undefined || patch.caps === undefined) {
    return effective.etfCores ?? current.etfCores
  }

  return Object.fromEntries(
    Object.entries(patch.caps).flatMap(([segment, caps]) => {
      const id = portfolioSegment(segment)
      const stated = caps.minimumEtfPctNav
      const core =
        isSegmentDisabled(caps) || stated === current.caps[id]?.minimumEtfPctNav
          ? current.etfCores[id]
          : stated

      return core === undefined ? [] : [[id, core]]
    })
  )
}

/** Each asked core held under its sleeve's current ceilings, so a clamped core comes back once they
 *  widen. A closed sleeve carries none. */
function heldEtfCores(caps: UserProfile['caps'], cores: EtfCores): UserProfile['caps'] {
  return Object.fromEntries(
    Object.entries(caps).map(([segment, cap]) => [
      segment,
      withEtfCore(cap, cores[portfolioSegment(segment)]),
    ])
  )
}

function withEtfCore(cap: RiskCapSet, core: number | undefined): RiskCapSet {
  const { minimumEtfPctNav: _held, ...rest } = cap

  if (core === undefined || isSegmentDisabled(cap)) {
    return rest
  }

  return {
    ...rest,
    minimumEtfPctNav: Math.min(core, cap.maximumEtfPctNav ?? cap.maximumSegmentPctNav),
  }
}

function openPins(
  pinned: Readonly<Partial<Record<PortfolioSegment, number>>>,
  off: ReadonlySet<PortfolioSegment>
): Readonly<Partial<Record<PortfolioSegment, number>>> {
  return Object.fromEntries(
    Object.entries(pinned).filter(([segment]) => !off.has(portfolioSegment(segment)))
  )
}

/** Mutable on purpose: a toggle adds or removes one sleeve before seeding. Read off the kernel's
 *  caps answer and restricted to the registered segments, so a stored cap no market registers
 *  cannot seed. */
export function offSegments(current: UserProfile, context: ProfileContext): Set<PortfolioSegment> {
  const closed = disabledSegments(current.caps)

  return new Set(
    context.segments.map((descriptor) => descriptor.id).filter((segment) => closed.has(segment))
  )
}

/** Exactly the fields `RISK_TABLE` drives, so a reset and a level change seed the same set. Pins and
 *  ETF cores travel with them: a level change keeps both, a reset clears both. */
function toRiskPolicyPatch(seeded: UserProfile): ProfilePatch {
  return {
    segmentTargets: seeded.segmentTargets,
    pinnedTargets: seeded.pinnedTargets,
    etfCores: seeded.etfCores,
    caps: seeded.caps,
    maximumSectorPctNav: seeded.maximumSectorPctNav,
    reservePctNav: seeded.reservePctNav,
    regimeScale: seeded.regimeScale,
    riskPerTradePctNav: seeded.riskPerTradePctNav,
    maximumOpenRiskPctNav: seeded.maximumOpenRiskPctNav,
  }
}

// Present fields only: an explicit `undefined` in a spread would erase a stored value.
function applyOptional(patch: ProfilePatch): Partial<UserProfile> {
  return {
    ...(patch.preferredLocale === undefined ? {} : { preferredLocale: patch.preferredLocale }),
    ...(patch.goal === undefined ? {} : { goal: patch.goal }),
    ...(patch.watchlist === undefined ? {} : { watchlist: patch.watchlist }),
    ...(patch.exclusions === undefined ? {} : { exclusions: patch.exclusions }),
    ...(patch.segmentTargets === undefined ? {} : { segmentTargets: patch.segmentTargets }),
    ...(patch.pinnedTargets === undefined ? {} : { pinnedTargets: patch.pinnedTargets }),
    ...(patch.caps === undefined ? {} : { caps: patch.caps }),
    ...(patch.maximumSectorPctNav === undefined
      ? {}
      : { maximumSectorPctNav: patch.maximumSectorPctNav }),
    ...(patch.reservePctNav === undefined ? {} : { reservePctNav: patch.reservePctNav }),
    ...(patch.regimeScale === undefined ? {} : { regimeScale: patch.regimeScale }),
    ...(patch.riskPerTradePctNav === undefined
      ? {}
      : { riskPerTradePctNav: patch.riskPerTradePctNav }),
    ...(patch.maximumOpenRiskPctNav === undefined
      ? {}
      : { maximumOpenRiskPctNav: patch.maximumOpenRiskPctNav }),
    ...(patch.entryTranchePct === undefined ? {} : { entryTranchePct: patch.entryTranchePct }),
    ...(patch.takeProfitTranchePct === undefined
      ? {}
      : { takeProfitTranchePct: patch.takeProfitTranchePct }),
  }
}

/** A patch names the sleeves it changes; the rest keep what they had. Written as a fold rather than
 *  a spread because a partial record spreads as possibly-undefined under `exactOptionalPropertyTypes`. */
function mergeHorizons(
  current: Readonly<Record<PortfolioSegment, InvestmentHorizon>>,
  patch: Readonly<Partial<Record<PortfolioSegment, InvestmentHorizon>>> | undefined
): Readonly<Record<PortfolioSegment, InvestmentHorizon>> {
  const merged: Record<PortfolioSegment, InvestmentHorizon> = { ...current }

  for (const [segment, horizon] of Object.entries(patch ?? {})) {
    if (horizon !== undefined) {
      merged[portfolioSegment(segment)] = horizon
    }
  }

  return merged
}
