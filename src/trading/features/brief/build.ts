import type { RunId, SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Budget } from '@/core/types/budget'
import type { Locale } from '@/core/types/locale'
import type { MarketBriefDeps } from '@/trading/features/brief/run'
import type { BriefStore } from '@/trading/features/brief/store/brief'
import type { BriefResult, BriefServices, BriefSnapshot } from '@/trading/features/brief/types'
import type { EnsureMarketData } from '@/trading/features/market-data/ops/ensure'
import type { ProfileStore } from '@/trading/features/profile/store'
import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingConfig } from '@/trading/kernel/config'
import type {
  InstrumentRef,
  PortfolioSegment,
  Region,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { BriefSectionKind, BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { StoryCode } from '@/trading/kernel/operator/brief-story'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { StageReporter } from '@/trading/kernel/surface/tool-progress'
import type { MarketBriefRun } from '@/trading/markets/deps'
import type { Market } from '@/trading/markets/types'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { runMarketBrief } from '@/trading/features/brief/run'
import { buildBriefSnapshotId } from '@/trading/features/brief/types'
import { buildEnsureOptions } from '@/trading/features/market-data/market-data-run'
import { profileRevisionOf } from '@/trading/features/profile/store'
import { ticker } from '@/trading/kernel/instrument'
import { disabledSegments } from '@/trading/kernel/operator/profile'
import { isDeliverable } from '@/trading/markets/brief-deliverability'
import { withoutOmitted } from '@/trading/markets/brief-sections'

const BRIEF_WATCHLIST_LIMIT_PER_SCOPE = 20
/** The section whose rows record which names were eligible on the day it was built. */
const ELIGIBLE_SECTION = 'watchlist-leading'
const SCORECARD_SECTION = 'monthly-scorecard'
const MONTH_KEY_LENGTH = 7

/** What persistence needs beyond the sections: `scorecardShownThisMonth` because an omitted
 *  scorecard cannot say whether it was suppressed or had nothing to report, and the refresh caveats
 *  because they describe the data every section was built from. */
interface ComposedBrief {
  readonly sections: readonly BriefSectionResult[]
  readonly caveats: readonly Caveat[]
  readonly scorecardShownThisMonth: boolean
  readonly profileRevision: string
}

/** The resolved profile, which switches a market newer than the saved row off. */
interface HomeProfile {
  get(options: { readonly signal: AbortSignal }): Promise<UserProfile>
  homeSegment(): PortfolioSegment | undefined
}

export interface BriefBuildDeps {
  readonly store: BriefStore
  readonly profiles: ProfileStore
  readonly profile: HomeProfile
  readonly config: TradingConfig
  readonly ensure: EnsureMarketData
  readonly logger: Logger
  /** What the sections read of the operator's book and the market; the market never holds them. */
  readonly reads: BriefServices
  /** Sections this edition leaves out of every brief it builds; absent builds them all. */
  readonly omitSections?: ReadonlySet<BriefSectionKind>
  /** Market stories this edition never tells; absent tells them all. */
  readonly omitStories?: ReadonlySet<StoryCode>
  /** The brief's own budget; its two suggestion sections draw from this and never from a caller's
   *  parent run. */
  createSuggestionBudget(): Budget
}

interface BriefBuildInput {
  readonly market: Market
  readonly region: Region
  readonly asOf: TradingDay
  readonly locale: Locale
  readonly now: number
  readonly signal: AbortSignal
  /** Absent when nobody is waiting on the build; the surface owns how a reported step is shown. */
  readonly progress?: StageReporter
  /** Skips reuse so the operator can rebuild against data a refresh has since replaced. */
  readonly forced?: boolean
  readonly billingSessionId?: SessionId
  /** The command run that asked; the suggestion batches the build runs are its children. */
  readonly parentRunId?: RunId
}

interface SnapshotLookupInput {
  readonly asOf: TradingDay
  readonly locale: Locale
  readonly profile: UserProfile | null
  readonly signal: AbortSignal
}

/** `current` is the day's snapshot still answering today's question; `stale` is one the profile has
 *  moved past, which a caller must rebuild rather than fall back around; `absent` is no row at all. */
type SnapshotLookup =
  | { readonly kind: 'current'; readonly snapshot: BriefSnapshot }
  | { readonly kind: 'stale' }
  | { readonly kind: 'absent' }

/** The one gate on reusing a stored brief, shared by the build and by the operator's own read so
 *  the two cannot answer differently. `(day, locale)` names the row; the profile revision decides
 *  whether it is still this day's answer. */
export async function findCurrentSnapshot(
  deps: BriefBuildDeps,
  input: SnapshotLookupInput
): Promise<SnapshotLookup> {
  const snapshot = await readSnapshot(deps, input)

  if (snapshot === null) {
    return { kind: 'absent' }
  }

  const revision = profileRevisionOf(input.profile)

  return snapshot.profileRevision === revision ? { kind: 'current', snapshot } : { kind: 'stale' }
}

/** A stored snapshot carries the field vocabulary of the build that wrote it, so one this build can
 *  no longer read is treated as absent and rebuilt. Rebuilding costs a run; rendering it would print
 *  a field the catalog cannot name, which `t` returns as its own raw key, and throwing would take a
 *  surface down over a derived artifact. */
async function readSnapshot(
  deps: BriefBuildDeps,
  input: SnapshotLookupInput
): Promise<BriefSnapshot | null> {
  try {
    return await deps.store.findExact({
      asOf: input.asOf,
      authoredLocale: input.locale,
      signal: input.signal,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.brief_snapshot_unreadable', {
      asOf: input.asOf,
      err: formatErrForLog(err),
    })

    return null
  }
}

/** A market without a brief capability is refused first, so a stored snapshot is never served for
 *  another region. Reuse is by the stored row's `(day, locale)` and the profile revision it was built
 *  against. It must not suppress delivery: a snapshot built for a send that failed still needs
 *  sending. */
export async function findOrBuildBrief(
  deps: BriefBuildDeps,
  input: BriefBuildInput
): Promise<BriefResult> {
  const capability = input.market.capabilities.brief

  if (capability === undefined) {
    return { kind: 'suppressed', reason: 'no-deliverable-content' }
  }

  const profile = await deps.profiles.find(input.signal)

  if (input.forced !== true) {
    const existing = await findCurrentSnapshot(deps, { ...input, profile })

    if (existing.kind === 'current') {
      return { kind: 'ready', snapshot: visibleSnapshot(deps, existing.snapshot), reused: true }
    }
  }

  input.progress?.('trading.progress.brief.data')

  const caveats = [
    ...(await deps.ensure(buildEnsureOptions(input.market.manifest.id, input))),
    ...(await homeOffCaveats(deps, input.signal)),
  ]

  // Read once: the request wants the day before for its deltas, and the story step wants it for
  // the stories still open. A same-day rebuild reads the same row, so it rebuilds the same result.
  const previous = await previousSnapshot(deps, input)
  const request = buildRequest(deps, { ...input, profile, previous })

  input.progress?.('trading.progress.brief.sections')
  const sections = await runMarketBrief(toRunDeps(deps), {
    market: input.market,
    request,
    previous,
    asOf: input.asOf,
  })

  input.progress?.('trading.progress.brief.persist')

  return persist(deps, input, {
    sections,
    caveats,
    scorecardShownThisMonth: request.scorecardShownThisMonth,
    profileRevision: profileRevisionOf(profile),
  })
}

function toRunDeps(deps: BriefBuildDeps): MarketBriefDeps {
  return {
    logger: deps.logger,
    limit: deps.config.briefs.maximumItemsPerSection,
    ...(deps.omitSections === undefined ? {} : { omitSections: deps.omitSections }),
    ...(deps.omitStories === undefined ? {} : { omitStories: deps.omitStories }),
  }
}

/** What leaves the brief service: the edition's omitted sections read as omitted. The store keeps
 *  them whole, because the next build recovers its eligible names from one. */
function visibleSnapshot(deps: BriefBuildDeps, snapshot: BriefSnapshot): BriefSnapshot {
  return { ...snapshot, sections: withoutOmitted(snapshot.sections, deps.omitSections) }
}

/** A profile saved before the home moved can keep the new home market switched off. */
async function homeOffCaveats(
  deps: BriefBuildDeps,
  signal: AbortSignal
): Promise<readonly Caveat[]> {
  const segment = deps.profile.homeSegment()

  if (segment === undefined) {
    return []
  }

  const { caps } = await deps.profile.get({ signal })

  return disabledSegments(caps).has(segment)
    ? [{ code: 'brief.home-segment-off', detail: { segment } }]
    : []
}

/** Suppression is by named core sections, not a ready count: a brief where a core section failed
 *  is worse than no brief — it trains the user to ignore the one surface the product delivers
 *  unprompted. Enrichment sections may all be unavailable and the brief still ships. */
async function persist(
  deps: BriefBuildDeps,
  input: BriefBuildInput,
  composed: ComposedBrief
): Promise<BriefResult> {
  const { sections } = composed

  // Judged on what the edition shows: a section it hides cannot make a brief worth sending.
  if (
    !isDeliverable(withoutOmitted(sections, deps.omitSections), deps.config.briefs.coreSections)
  ) {
    return { kind: 'suppressed', reason: 'no-deliverable-content' }
  }

  const scorecardMonth = settledScorecardMonth(composed, input.asOf)
  const snapshot: BriefSnapshot = {
    id: buildBriefSnapshotId(input.now),
    asOf: input.asOf,
    authoredLocale: input.locale,
    profileRevision: composed.profileRevision,
    sections,
    caveats: composed.caveats,
    ...(scorecardMonth === undefined ? {} : { scorecardMonth }),
    createdAt: input.now,
  }

  await deps.store.upsertSnapshot(snapshot, input.signal)

  return { kind: 'ready', snapshot: visibleSnapshot(deps, snapshot), reused: false }
}

/** What the reader saw before this day, for the sections that report a change since: a same-day
 *  rebuild must not take its own earlier snapshot for the previous one. Unreadable is absent for
 *  the same reason a reused one is: this build rebuilding is the point, and a snapshot written in a
 *  vocabulary it no longer speaks must not fail the run that would replace it. */
async function previousSnapshot(
  deps: BriefBuildDeps,
  input: BriefBuildInput
): Promise<BriefSnapshot | null> {
  try {
    return await deps.store.findPrevious({
      before: input.asOf,
      authoredLocale: input.locale,
      signal: input.signal,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.brief_previous_unreadable', { err: formatErrForLog(err) })

    return null
  }
}

interface RequestInput extends BriefBuildInput {
  readonly profile: UserProfile | null
  readonly previous: BriefSnapshot | null
}

function buildRequest(deps: BriefBuildDeps, input: RequestInput): MarketBriefRun {
  const { profile, previous } = input
  const policy = deps.config.briefs
  const eligible = previous === null ? undefined : eligibleNames(previous, input.market)

  return {
    region: input.region,
    locale: input.locale,
    asOf: input.asOf,
    now: input.now,
    signal: input.signal,
    watchlist: boundedWatchlist(profile?.watchlist ?? [], input.market.manifest.id),
    ...(eligible === undefined || eligible.length === 0
      ? {}
      : { previousEligibleWatchlist: eligible }),
    limit: policy.maximumItemsPerSection,
    // "Since your last brief" is the previous snapshot's instant; a user's first brief falls back
    // to the configured lookback rather than reporting every event ever recorded.
    activitySince: previous?.createdAt ?? input.now - policy.activityLookbackMs,
    scorecardShownThisMonth: previous?.scorecardMonth === monthOf(input.asOf),
    channel: LOCAL_CHANNEL_ID,
    billingSessionId: input.billingSessionId ?? null,
    ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
    budget: deps.createSuggestionBudget(),
    ...(input.progress === undefined ? {} : { progress: input.progress }),
    reads: deps.reads,
  }
}

function boundedWatchlist(
  watchlist: readonly InstrumentRef[],
  market: InstrumentRef['market']
): readonly InstrumentRef[] {
  const local = watchlist
    .filter((instrument) => instrument.market === market)
    .slice(0, BRIEF_WATCHLIST_LIMIT_PER_SCOPE)
  const crossAsset = watchlist
    .filter((instrument) => instrument.market !== market)
    .slice(0, BRIEF_WATCHLIST_LIMIT_PER_SCOPE)

  return [...local, ...crossAsset]
}

/** Recovered from the previous snapshot's leading-names rows, which are the only persisted record
 *  of what was eligible. That section is truncated to the per-section limit, so a name that was
 *  eligible but never made the list cannot be reported as dropped. */
function eligibleNames(previous: BriefSnapshot, market: Market): readonly InstrumentRef[] {
  const section = previous.sections.find((entry) => entry.kind === ELIGIBLE_SECTION)

  if (section === undefined || section.status !== 'ready') {
    return []
  }

  return section.rows.flatMap<InstrumentRef>((row) => {
    const raw = row.ticker

    return typeof raw === 'string' ? [{ market: market.manifest.id, ticker: ticker(raw) }] : []
  })
}

/** Sticky within the month: once the scorecard renders, every later snapshot that month carries the
 *  month forward, so the gate counts deliveries rather than briefs. */
function settledScorecardMonth(composed: ComposedBrief, asOf: TradingDay): string | undefined {
  const delivered =
    composed.scorecardShownThisMonth ||
    composed.sections.some(
      (section) => section.kind === SCORECARD_SECTION && section.status === 'ready'
    )

  return delivered ? monthOf(asOf) : undefined
}

function monthOf(day: TradingDay): string {
  return day.slice(0, MONTH_KEY_LENGTH)
}
