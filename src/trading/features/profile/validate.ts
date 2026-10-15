import type {
  PolicyBound,
  ProfileBounds,
  SegmentDescriptor,
} from '@/trading/features/profile/policy'
import type { ProfileContext } from '@/trading/features/profile/types'
import type { InstrumentRef, PortfolioSegment } from '@/trading/kernel/instrument'
import type {
  InvestmentHorizon,
  ProfilePatch,
  RiskCapSet,
  UserProfile,
} from '@/trading/kernel/operator/profile'
import { ValidationError } from '@/core/errors'
import {
  EXCLUSION_MAXIMUM_ENTRIES,
  TARGET_SUM_EPSILON,
  WATCHLIST_MAXIMUM_ENTRIES,
} from '@/trading/features/profile/policy'
import { buildInstrumentKey, CASH_SEGMENT, portfolioSegment } from '@/trading/kernel/instrument'
import { isSegmentDisabled } from '@/trading/kernel/operator/profile'

/** Every rule a profile must satisfy to be stored, applied to the patch as it will stand once
 *  merged. Split from the merge itself so the two read apart: one decides what the next profile is,
 *  this one decides whether it may exist. */
export function assertPatch(
  current: UserProfile,
  patch: ProfilePatch,
  context: ProfileContext
): void {
  assertRiskInput(patch)
  assertLists(current, patch)
  assertTargets(patch.segmentTargets, context)
  assertPinnedTargets(patch.pinnedTargets, patch.segmentTargets ?? current.segmentTargets, context)
  assertHorizons(patch.horizons, context)
  assertCaps(patch.caps ?? current.caps, patch.segmentTargets ?? current.segmentTargets, context)
  assertBounds(patch, context.bounds)
}

// A direct level and a split level are two answers to one question; neither can be preferred.
function assertRiskInput(patch: ProfilePatch): void {
  if (
    patch.riskLevel !== undefined &&
    (patch.riskCapacity !== undefined || patch.riskWillingness !== undefined)
  ) {
    throw new ValidationError('profile patch mixes a direct risk level with split risk fields')
  }
}

function assertLists(current: UserProfile, patch: ProfilePatch): void {
  assertList(patch.watchlist, 'watchlist', WATCHLIST_MAXIMUM_ENTRIES)
  assertList(patch.exclusions, 'exclusions', EXCLUSION_MAXIMUM_ENTRIES)

  const watchlist = new Set((patch.watchlist ?? current.watchlist).map(buildInstrumentKey))
  const exclusions = patch.exclusions ?? current.exclusions
  const overlap = exclusions.find((entry) => watchlist.has(buildInstrumentKey(entry)))

  if (overlap) {
    throw new ValidationError(`instrument ${overlap.ticker} is both watched and excluded`)
  }
}

function assertList(
  entries: readonly InstrumentRef[] | undefined,
  label: string,
  maximum: number
): void {
  if (entries === undefined) {
    return
  }

  if (entries.length > maximum) {
    throw new ValidationError(`${label} exceeds ${maximum} entries`)
  }

  if (new Set(entries.map(buildInstrumentKey)).size !== entries.length) {
    throw new ValidationError(`${label} repeats an instrument`)
  }
}

function assertTargets(
  targets: Readonly<Record<PortfolioSegment, number>> | undefined,
  context: ProfileContext
): void {
  if (targets === undefined) {
    return
  }

  const required = [CASH_SEGMENT, ...context.segments.map((segment) => segment.id)]

  assertExactKeys(Object.keys(targets), required, 'segment targets')

  let total = 0

  for (const [segment, weight] of Object.entries(targets)) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new ValidationError(`target for ${segment} is outside the unit interval`)
    }

    total += weight
  }

  if (Math.abs(total - 1) > TARGET_SUM_EPSILON) {
    throw new ValidationError('segment targets do not sum to one')
  }
}

/** A pin is only ever a claim about a registered sleeve, and the targets it was applied to must
 *  already honour it — anything else means the two records were written apart. */
function assertPinnedTargets(
  pinned: Readonly<Partial<Record<PortfolioSegment, number>>> | undefined,
  targets: Readonly<Record<PortfolioSegment, number>>,
  context: ProfileContext
): void {
  if (pinned === undefined) {
    return
  }

  const registered = new Set<string>(context.segments.map((segment) => segment.id))

  for (const [segment, weight] of Object.entries(pinned)) {
    if (!registered.has(segment)) {
      throw new ValidationError(`pinned targets name unregistered segment ${segment}`)
    }

    if (Math.abs((targets[portfolioSegment(segment)] ?? 0) - (weight ?? 0)) > TARGET_SUM_EPSILON) {
      throw new ValidationError(`pinned target for ${segment} disagrees with its segment target`)
    }
  }
}

function assertHorizons(
  horizons: Readonly<Partial<Record<PortfolioSegment, InvestmentHorizon>>> | undefined,
  context: ProfileContext
): void {
  if (horizons === undefined) {
    return
  }

  const registered = new Set<string>(context.segments.map((segment) => segment.id))

  for (const segment of Object.keys(horizons)) {
    if (!registered.has(segment)) {
      throw new ValidationError(`horizons name unregistered segment ${segment}`)
    }
  }
}

function assertCaps(
  caps: Readonly<Record<PortfolioSegment, RiskCapSet>>,
  targets: Readonly<Record<PortfolioSegment, number>>,
  context: ProfileContext
): void {
  assertExactKeys(
    Object.keys(caps),
    context.segments.map((segment) => segment.id),
    'caps'
  )

  for (const descriptor of context.segments) {
    const entry = caps[descriptor.id]

    if (!entry) {
      throw new ValidationError(`caps are missing segment ${descriptor.id}`)
    }

    if (!isSegmentDisabled(entry)) {
      assertSegmentHeld(descriptor)
    }

    assertCategoryBounds(entry, descriptor, context.bounds)
    assertSegmentCeiling(entry, descriptor.id, targets[descriptor.id] ?? 0)
  }
}

/** A disabled sleeve is the one cap set below its category floor: zero room is a decision, not a
 *  number to be floored back up. The ceiling check beside this still forces its target to zero. */
function assertCategoryBounds(
  entry: RiskCapSet,
  descriptor: SegmentDescriptor,
  bounds: ProfileBounds
): void {
  if (isSegmentDisabled(entry)) {
    return
  }

  const position = bounds.positionPctNavByCategory[descriptor.category]
  const segment = bounds.segmentPctNavByCategory[descriptor.category]

  if (position) {
    assertWithin(entry.maximumPositionPctNav, position, `position-cap ${descriptor.id}`)
  }

  if (segment) {
    assertWithin(entry.maximumSegmentPctNav, segment, `segment-cap ${descriptor.id}`)
  }
}

function assertSegmentCeiling(entry: RiskCapSet, segment: PortfolioSegment, target: number): void {
  if (!Number.isFinite(entry.maximumSegmentPctNav) || entry.maximumSegmentPctNav > 1) {
    throw new ValidationError(`segment ceiling for ${segment} exceeds one`)
  }

  if (
    entry.maximumSegmentPctNav < target ||
    entry.maximumSegmentPctNav < entry.maximumPositionPctNav
  ) {
    throw new ValidationError(
      `segment ceiling for ${segment} is below its target or position cap`,
      {
        key: 'errors.profileCeilingBelowTarget',
        params: { segment },
      }
    )
  }

  if (
    entry.maximumEtfPctNav !== undefined &&
    (!Number.isFinite(entry.maximumEtfPctNav) ||
      entry.maximumEtfPctNav < 0 ||
      entry.maximumEtfPctNav > entry.maximumSegmentPctNav)
  ) {
    throw new ValidationError(
      `segment ETF cap for ${segment} is below zero or above its segment ceiling`
    )
  }

  const core = entry.minimumEtfPctNav

  if (
    core !== undefined &&
    (!Number.isFinite(core) ||
      core < 0 ||
      core > entry.maximumSegmentPctNav ||
      core > (entry.maximumEtfPctNav ?? entry.maximumSegmentPctNav))
  ) {
    throw new ValidationError(
      `segment ETF core for ${segment} is below zero or above its ETF cap or segment ceiling`
    )
  }
}

function assertBounds(patch: ProfilePatch, bounds: ProfileBounds): void {
  assertOptionalWithin(
    patch.maximumSectorPctNav,
    bounds.maximumSectorPctNav,
    'maximum-sector-pct-nav'
  )
  assertOptionalWithin(patch.reservePctNav, bounds.reservePctNav, 'reserve-pct-nav')
  assertOptionalWithin(patch.regimeScale, bounds.regimeScale, 'regime-scale')
  assertOptionalWithin(
    patch.riskPerTradePctNav,
    bounds.riskPerTradePctNav,
    'risk-per-trade-pct-nav'
  )
  assertOptionalWithin(
    patch.maximumOpenRiskPctNav,
    bounds.maximumOpenRiskPctNav,
    'maximum-open-risk-pct-nav'
  )
  assertOptionalWithin(patch.entryTranchePct, bounds.entryTranchePct, 'entry-tranche-pct')
  assertOptionalWithin(
    patch.takeProfitTranchePct,
    bounds.takeProfitTranchePct,
    'take-profit-tranche-pct'
  )
}

function assertOptionalWithin(value: number | undefined, bound: PolicyBound, label: string): void {
  if (value !== undefined) {
    assertWithin(value, bound, label)
  }
}

/** `field` is the name the operator types after `/profile set`, so the refusal names the knob. */
function assertWithin(value: number, bound: PolicyBound, field: string): void {
  if (!Number.isFinite(value) || value < bound.minimum || value > bound.maximum) {
    throw new ValidationError(`${field} must be between ${bound.minimum} and ${bound.maximum}`, {
      key: 'errors.profileOutOfBounds',
      params: { field, minimum: bound.minimum, maximum: bound.maximum },
    })
  }
}

// A profile naming a segment no market owns is a boot error, not a silent extra key.
function assertExactKeys(
  actual: readonly string[],
  required: readonly string[],
  label: string
): void {
  const expected = new Set<string>(required)

  for (const key of actual) {
    if (!expected.has(key)) {
      throw new ValidationError(`${label} names unregistered segment ${key}`)
    }
  }

  if (actual.length !== expected.size) {
    throw new ValidationError(`${label} must name every registered segment exactly once`)
  }
}

/** A sleeve no venue trades is read for reference only: nothing could fill a position in it. */
export function assertSegmentHeld(descriptor: SegmentDescriptor): void {
  if (!descriptor.held) {
    throw new ValidationError(`segment ${descriptor.id} has no venue to trade it`, {
      key: 'errors.profileSegmentNoVenue',
      params: { segment: { key: `trading.segment.${descriptor.id}`, fallback: descriptor.id } },
    })
  }
}
