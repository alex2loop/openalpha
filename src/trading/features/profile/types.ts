import type { Locale } from '@/core/types/locale'
import type { ProfileBounds, SegmentDescriptor } from '@/trading/features/profile/policy'
import type { Caveat } from '@/trading/kernel/caveat'
import type {
  InstrumentKind,
  InstrumentRef,
  PortfolioSegment,
  TickerRequest,
} from '@/trading/kernel/instrument'
import type { ProfilePatch, UserProfile } from '@/trading/kernel/operator/profile'

export const SEGMENT_TOGGLES = Object.freeze(['enable', 'disable'] as const)
type SegmentToggle = (typeof SEGMENT_TOGGLES)[number]

export interface SegmentRequest {
  readonly kind: SegmentToggle
  readonly segment: PortfolioSegment
}

export const SEGMENT_POLICY_FIELDS = Object.freeze([
  'segment-target',
  'segment-cap',
  'position-cap',
] as const)
type SegmentPolicyField = (typeof SEGMENT_POLICY_FIELDS)[number]

export interface SegmentPolicyRequest {
  readonly field: SegmentPolicyField
  readonly segment: PortfolioSegment
  readonly pctNav: number
}

/** What a profile is validated against: the sleeves the registry holds and the ranges their numbers
 *  must fall in. Owned here rather than by the merge, so the merge and the validator can both read
 *  it without depending on each other. */
export interface ProfileContext {
  readonly segments: readonly SegmentDescriptor[]
  readonly bounds: ProfileBounds
}

/** Every read seeds when nothing is stored, so a caller that has never saved still gets a whole
 *  profile - and must say which locale to seed it in, because the seed carries one. */
export interface GetProfileOptions {
  readonly defaultLocale: Locale
  readonly signal: AbortSignal
}

export interface UpdateProfileOptions extends GetProfileOptions {
  readonly patch: ProfilePatch
}

export interface UpdateSegmentOptions extends GetProfileOptions, SegmentRequest {}

export interface UpdateSegmentPolicyOptions extends GetProfileOptions, SegmentPolicyRequest {}

export interface UpdateWatchlistOptions extends GetProfileOptions {
  readonly kind: 'add' | 'remove'
  readonly tickers: readonly TickerRequest[]
}

/** An unresolved name comes back as caveats rather than as a partial save: a list holding a name
 *  nobody can price is not one to store. */
export type WatchlistResult =
  | {
      readonly kind: 'watchlist'
      readonly instruments: readonly InstrumentRef[]
      /** Per instrument key, the kind the stored record files it under. Empty where no name was
       *  newly resolved — a row whose kind is unknown prints bare. */
      readonly instrumentKinds: ReadonlyMap<string, InstrumentKind>
    }
  | { readonly kind: 'unresolved'; readonly caveats: readonly Caveat[] }

/** The operator's own policy: what they will risk, what they are aiming at, and the names they
 *  watch. Owned here rather than by the book, which reads it but never decides it. */
export interface ProfileService {
  get(options: GetProfileOptions): Promise<UserProfile>
  /** Whether the operator ever saved one. `get` seeds defaults when they did not, and a seeded
   *  policy is indistinguishable from a chosen one once it is returned. */
  isSaved(options: GetProfileOptions): Promise<boolean>
  update(options: UpdateProfileOptions): Promise<UserProfile>
  reset(options: GetProfileOptions): Promise<UserProfile>
  /** The sleeves a profile allocates to. Cash is absent: it is the residual every other sleeve is
   *  funded from, not a registered market's segment. */
  segments(): readonly PortfolioSegment[]
  /** Those of them some venue holds, the only ones that can be switched on. */
  heldSegments(): readonly PortfolioSegment[]
  /** Switches one sleeve off or back on. Off is a cap of zero, which every sizer already reads as
   *  no room, so nothing there is screened, sized, or bought. */
  updateSegment(options: UpdateSegmentOptions): Promise<UserProfile>
  /** Sets one sleeve's target or either of its ceilings. A target is what the book is steered to
   *  and the other sleeves absorb the change; a ceiling is only room, so moving one moves no
   *  money. */
  updateSegmentPolicy(options: UpdateSegmentPolicyOptions): Promise<UserProfile>
  updateWatchlist(options: UpdateWatchlistOptions): Promise<WatchlistResult>
}

/** The profile surface an agent may hold: it may read the policy and change it on the operator's
 *  word, and it may curate the watchlist. Reset is not here - clearing every limit is an operator
 *  action, not a turn's side effect. */
export type AgentProfile = Pick<
  ProfileService,
  'get' | 'update' | 'updateWatchlist' | 'updateSegment' | 'heldSegments'
>
