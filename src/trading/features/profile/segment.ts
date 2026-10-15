import type { SegmentDescriptor } from '@/trading/features/profile/policy'
import type {
  ProfileContext,
  SegmentPolicyRequest,
  SegmentRequest,
} from '@/trading/features/profile/types'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import type { RiskCapSet, UserProfile } from '@/trading/kernel/operator/profile'
import { ValidationError } from '@/core/errors'
import { offSegments, seedRiskPolicy, updateProfile } from '@/trading/features/profile/merge'
import { applyPinnedTargets } from '@/trading/features/profile/policy'
import { assertSegmentHeld } from '@/trading/features/profile/validate'
import { CASH_SEGMENT } from '@/trading/kernel/instrument'
import { DISABLED_CAPS, isSegmentDisabled } from '@/trading/kernel/operator/profile'

/** A sleeve the registry has that a stored profile does not name, filled so the row is structurally
 *  complete again. Registering a market makes every profile saved before it incomplete for that
 *  sleeve - no horizon, no target, no caps - and `horizonFor` throws on the first one rather than
 *  defaulting, because for every other sleeve an absent entry really is the registry and the row
 *  disagreeing. A profile is operator data no reset regenerates, so it must read.
 *
 *  Seeded **off**, never allocated: zero target and `DISABLED_CAPS`, which is exactly the state
 *  `seedsDefaultTarget: false` already describes for world gold - analyzed and quoted like any
 *  other, starting at zero so its share is not parked in cash under a target nobody chose. Adding
 *  a sleeve must not silently move NAV into it, and the targets still sum to one. The operator
 *  admits it with `/profile enable <segment>`, which re-seeds every sleeve with the new set on.
 *
 *  The same in reverse: a sleeve the registry no longer has is dropped, and any target it carried
 *  goes back to cash, because a profile naming a sleeve no market owns is refused on its next
 *  write.
 *
 *  A read, never a write: the stored row is untouched and `isSaved` still answers true. */
export function withRegisteredSegments(current: UserProfile, context: ProfileContext): UserProfile {
  const registered = new Set<string>(context.segments.map((descriptor) => descriptor.id))
  const missing = context.segments.filter((descriptor) => current.caps[descriptor.id] === undefined)
  const stale = Object.keys(current.caps).some((segment) => !registered.has(segment))

  if (missing.length === 0 && !stale) {
    return current
  }

  const filled = {
    ...current,
    horizons: { ...current.horizons, ...entriesOf(missing, (segment) => segment.horizon) },
    segmentTargets: { ...current.segmentTargets, ...entriesOf(missing, () => 0) },
    caps: { ...current.caps, ...entriesOf(missing, () => DISABLED_CAPS) },
  }

  return stale ? withoutUnregistered(filled, registered) : filled
}

function withoutUnregistered(profile: UserProfile, registered: ReadonlySet<string>): UserProfile {
  const targets = onlyIn(profile.segmentTargets, new Set([...registered, CASH_SEGMENT]))
  const dropped = sumOf(profile.segmentTargets) - sumOf(targets)

  return {
    ...profile,
    horizons: onlyIn(profile.horizons, registered),
    segmentTargets: { ...targets, [CASH_SEGMENT]: (targets[CASH_SEGMENT] ?? 0) + dropped },
    pinnedTargets: onlyIn(profile.pinnedTargets, registered),
    etfCores: onlyIn(profile.etfCores, registered),
    caps: onlyIn(profile.caps, registered),
  }
}

function onlyIn<TValue>(
  record: Readonly<Partial<Record<PortfolioSegment, TValue>>>,
  keep: ReadonlySet<string>
): Record<PortfolioSegment, TValue> {
  const kept: [string, TValue][] = []

  for (const [segment, value] of Object.entries(record)) {
    if (keep.has(segment) && value !== undefined) {
      kept.push([segment, value])
    }
  }

  return Object.fromEntries(kept)
}

function sumOf(targets: Readonly<Record<PortfolioSegment, number>>): number {
  return Object.values(targets).reduce((total, weight) => total + weight, 0)
}

function entriesOf<TValue>(
  segments: readonly SegmentDescriptor[],
  pick: (segment: SegmentDescriptor) => TValue
): Record<PortfolioSegment, TValue> {
  return Object.fromEntries(segments.map((segment) => [segment.id, pick(segment)]))
}

/** Switching a sleeve re-seeds every sleeve's target and caps at the current risk level with the
 *  new set off, so the book reads as a fresh profile that never held it: the freed weight spreads
 *  across the rest and their caps follow. A pinned target survives — re-seeding moves the other
 *  sleeves around it — but the switched sleeve's own pin goes with it, and a hand-set cap does
 *  not, the same trade a risk-level change already makes. An ETF core survives, even on the
 *  switched sleeve. */
export function updateSegment(
  current: UserProfile,
  request: SegmentRequest,
  context: ProfileContext
): UserProfile {
  // A stored profile names every registered sleeve exactly once, so an absent entry is a sleeve no
  // market registers rather than a gap to seed.
  if (current.caps[request.segment] === undefined) {
    throw new ValidationError(`profile has no segment ${request.segment}`)
  }

  const descriptor = context.segments.find((segment) => segment.id === request.segment)

  if (request.kind === 'enable' && descriptor !== undefined) {
    assertSegmentHeld(descriptor)
  }

  const off = offSegments(current, context)
  const wanted = request.kind === 'disable'

  if (off.has(request.segment) === wanted) {
    return current
  }

  if (wanted) {
    off.add(request.segment)
  } else {
    off.delete(request.segment)
  }

  const seeded = seedRiskPolicy({ current, context, riskLevel: current.riskLevel, off })

  return updateProfile(
    current,
    {
      segmentTargets: seeded.segmentTargets,
      pinnedTargets: seeded.pinnedTargets,
      etfCores: seeded.etfCores,
      caps: seeded.caps,
    },
    context
  )
}

/** One sleeve's own number, hand-set, merged into records the patch grammar can only replace whole.
 *  A target is where the book is steered and the rest of the sleeves absorb the change; a ceiling
 *  is only room, so raising one moves nothing into the sleeve. Both land through the same
 *  validation a seeded profile passes. */
export function updateSegmentPolicy(
  current: UserProfile,
  request: SegmentPolicyRequest,
  context: ProfileContext
): UserProfile {
  const entry = current.caps[request.segment]

  if (entry === undefined) {
    throw new ValidationError(`profile has no segment ${request.segment}`)
  }

  // Either edit on a closed sleeve would reopen it under a command that never said so.
  if (isSegmentDisabled(entry)) {
    throw new ValidationError(`segment ${request.segment} is off; enable it before setting it`, {
      key: 'errors.profileSegmentOff',
      params: { segment: request.segment },
    })
  }

  if (request.field === 'segment-target') {
    const pinned = { ...current.pinnedTargets, [request.segment]: request.pctNav }

    return updateProfile(
      current,
      { ...applyPinnedTargets({ ...current, pinned, ...context }), pinnedTargets: pinned },
      context
    )
  }

  const capped =
    request.field === 'position-cap'
      ? { ...entry, maximumPositionPctNav: request.pctNav }
      : withSegmentCeiling(entry, request.pctNav)

  return updateProfile(
    current,
    { caps: { ...current.caps, [request.segment]: capped }, etfCores: current.etfCores },
    context
  )
}

/** Every sub-ceiling is bounded by the sleeve's own, so lowering it lowers whatever sat above it.
 *  The other direction is refused rather than clamped: widening a sleeve is its own instruction. */
function withSegmentCeiling(entry: RiskCapSet, pctNav: number): RiskCapSet {
  const etfCap = entry.maximumEtfPctNav
  const etfCore = entry.minimumEtfPctNav

  return {
    ...entry,
    maximumSegmentPctNav: pctNav,
    maximumPositionPctNav: Math.min(entry.maximumPositionPctNav, pctNav),
    ...(etfCap === undefined ? {} : { maximumEtfPctNav: Math.min(etfCap, pctNav) }),
    ...(etfCore === undefined ? {} : { minimumEtfPctNav: Math.min(etfCore, pctNav) }),
  }
}
