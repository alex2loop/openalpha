import type { Locale } from '@/core/types/locale'
import type { ProfileStore } from '@/trading/features/profile/store'
import type {
  GetProfileOptions,
  ProfileContext,
  ProfileService,
  UpdateProfileOptions,
  UpdateSegmentOptions,
  UpdateSegmentPolicyOptions,
  UpdateWatchlistOptions,
  WatchlistResult,
} from '@/trading/features/profile/types'
import type { CurrencyCode, MarketRef, Region } from '@/trading/kernel/instrument'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { MarketManifest, MarketRegistry } from '@/trading/markets/types'
import { resetProfile, updateProfile } from '@/trading/features/profile/merge'
import {
  DEFAULT_SEED_WEIGHT,
  defaultProfile,
  PROFILE_BOUNDS,
} from '@/trading/features/profile/policy'
import {
  updateSegment,
  updateSegmentPolicy,
  withRegisteredSegments,
} from '@/trading/features/profile/segment'
import { resolveWatchlist } from '@/trading/features/profile/watchlist'

interface ProfileServiceDeps {
  readonly profiles: ProfileStore
  /** Read for the registered segments a profile must name exactly once, and to resolve a watched
   *  ticker to the market that lists it. */
  readonly markets: MarketRegistry
  /** The first stored profile fixes the currency, so a later config change cannot reinterpret
   *  historical facts. */
  readonly baseCurrency: CurrencyCode
  /** The locale a seeded profile carries when the caller admits none of its own. */
  readonly defaultLocale: Locale
  /** The operator's home region: a national market seeds a target only there. */
  readonly homeRegion: Region
  /** The markets some venue holds; the rest are read for reference and never sized. */
  readonly heldMarkets: ReadonlySet<MarketRef>
}

export function createProfileService(deps: ProfileServiceDeps): ProfileService {
  return {
    async get(options) {
      return (await resolve(deps, options)).profile
    },

    async isSaved(options) {
      return (await resolve(deps, options)).saved
    },

    update: (options) => savePatch(deps, options),

    async reset(options) {
      const current = (await resolve(deps, options)).profile

      return deps.profiles.upsert(
        resetProfile(current, contextOf(deps), current.riskLevel),
        options.signal
      )
    },

    segments: () => contextOf(deps).segments.map((descriptor) => descriptor.id),

    heldSegments: () =>
      contextOf(deps)
        .segments.filter((descriptor) => descriptor.held)
        .map((descriptor) => descriptor.id),

    updateSegment: (options) => saveSegment(deps, options),

    updateSegmentPolicy: (options) => saveSegmentPolicy(deps, options),

    updateWatchlist: (options) => saveWatchlist(deps, options),
  }
}

/** An unchanged profile is the same object by construction, and skipping its write matters: a
 *  no-op toggle must not turn a seeded default into a profile the operator is recorded as having
 *  chosen. */
async function saveSegment(
  deps: ProfileServiceDeps,
  options: UpdateSegmentOptions
): Promise<UserProfile> {
  const current = (await resolve(deps, options)).profile
  const next = updateSegment(
    current,
    { kind: options.kind, segment: options.segment },
    contextOf(deps)
  )

  return next === current ? current : deps.profiles.upsert(next, options.signal)
}

/** Always written, unlike a toggle: the operator named a number, so the profile is theirs from here
 *  even where that number is the one already stored. */
async function saveSegmentPolicy(
  deps: ProfileServiceDeps,
  options: UpdateSegmentPolicyOptions
): Promise<UserProfile> {
  const current = (await resolve(deps, options)).profile
  const next = updateSegmentPolicy(
    current,
    { field: options.field, segment: options.segment, pctNav: options.pctNav },
    contextOf(deps)
  )

  return deps.profiles.upsert(next, options.signal)
}

async function savePatch(
  deps: ProfileServiceDeps,
  options: UpdateProfileOptions
): Promise<UserProfile> {
  const current = (await resolve(deps, options)).profile

  return deps.profiles.upsert(
    updateProfile(current, options.patch, contextOf(deps)),
    options.signal
  )
}

/** An unresolved name comes back as-is: a list holding a name nobody can price is not one to save. */
async function saveWatchlist(
  deps: ProfileServiceDeps,
  options: UpdateWatchlistOptions
): Promise<WatchlistResult> {
  const current = (await resolve(deps, options)).profile
  const next = await resolveWatchlist(deps.markets, current, options)

  if (next.kind === 'unresolved') {
    return next
  }

  const saved = await deps.profiles.upsert(
    updateProfile(current, { watchlist: next.instruments }, contextOf(deps)),
    options.signal
  )

  return { kind: 'watchlist', instruments: saved.watchlist, instrumentKinds: next.instrumentKinds }
}

/** Whether the profile was stored answers a question the profile itself cannot: advice built on a
 *  seed is advice against a policy the operator never chose. Reads never write. */
async function resolve(
  deps: ProfileServiceDeps,
  options: GetProfileOptions
): Promise<{ readonly profile: UserProfile; readonly saved: boolean }> {
  const stored = await deps.profiles.find(options.signal)

  if (stored !== null) {
    return { profile: withRegisteredSegments(stored, contextOf(deps)), saved: true }
  }

  const seeded = defaultProfile({
    preferredLocale: options.defaultLocale,
    baseCurrency: deps.baseCurrency,
    segments: contextOf(deps).segments,
  })

  return { profile: seeded, saved: false }
}

/** A national market seeds only at home; any other follows its own flag, seeded when absent. */
function seedsAt(manifest: MarketManifest, homeRegion: Region): boolean {
  const seeds = manifest.seedsDefaultTarget

  return seeds === 'home' ? manifest.region === homeRegion : seeds !== false
}

/** The registered segments a profile is validated against, rebuilt per call: the registry is frozen
 *  at boot, so this is a projection rather than state. */
function contextOf(deps: ProfileServiceDeps): ProfileContext {
  return {
    segments: deps.markets.list().map(({ manifest }) => ({
      id: manifest.segment,
      category: manifest.segmentCategory,
      held: deps.heldMarkets.has(manifest.id),
      seedsDefaultTarget: deps.heldMarkets.has(manifest.id) && seedsAt(manifest, deps.homeRegion),
      seedWeight: manifest.seedWeight ?? DEFAULT_SEED_WEIGHT,
      holdsEtfs: manifest.screenableKinds?.includes('etf') === true,
      horizon: manifest.horizon,
    })),
    bounds: PROFILE_BOUNDS,
  }
}
