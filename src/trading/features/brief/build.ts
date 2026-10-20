import type { SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Budget } from '@/core/types/budget'
import type { Locale } from '@/core/types/locale'
import type { BriefStore } from '@/trading/features/brief/store/brief'
import type { BriefResult, BriefSnapshot } from '@/trading/features/brief/types'
import type { EnsureMarketData } from '@/trading/features/market-data/ops/refresh'
import type { ProfileStore } from '@/trading/features/profile/store'
import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingConfig } from '@/trading/kernel/config'
import type { InstrumentRef, Region, TradingDay } from '@/trading/kernel/instrument'
import type { MarketBriefRequest } from '@/trading/kernel/market/market-capability'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { MarketBrief } from '@/trading/kernel/operator/brief-story'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { StageReporter } from '@/trading/kernel/surface/tool-progress'
import type { Market } from '@/trading/markets/types'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { planStory } from '@/trading/features/brief/story/plan'
import { buildBriefSnapshotId } from '@/trading/features/brief/types'
import { buildEnsureOptions } from '@/trading/features/market-data/market-data-run'
import { profileRevisionOf } from '@/trading/features/profile/store'
import { ticker } from '@/trading/kernel/instrument'
import { isDeliverable } from '@/trading/markets/brief-deliverability'

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

export interface BriefBuildDeps {
  readonly store: BriefStore
  readonly profiles: ProfileStore
  readonly config: TradingConfig
  readonly ensure: EnsureMarketData
  readonly logger: Logger
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

  const revision = await profileRevisionOf(input.profile)

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

/** Reuse is by exact `(user, region, day, locale)` and the profile it was built against. It must not
 *  suppress delivery: a snapshot built for a send that failed still needs sending. */
export async function findOrBuildBrief(
  deps: BriefBuildDeps,
  input: BriefBuildInput
): Promise<BriefResult> {
  const profile = await deps.profiles.find(input.signal)

  if (input.forced !== true) {
    const existing = await findCurrentSnapshot(deps, { ...input, profile })

    if (existing.kind === 'current') {
      return { kind: 'ready', snapshot: existing.snapshot, reused: true }
    }
  }

  const capability = input.market.capabilities.brief

  if (capability === undefined) {
    return { kind: 'suppressed', reason: 'no-deliverable-content' }
  }

  input.progress?.('trading.progress.brief.data')

  const caveats = await deps.ensure(buildEnsureOptions(input.market.manifest.id, input))

  // Read once: the request wants the day before for its deltas, and the story step wants it for
  // the stories still open. A same-day rebuild reads the same row, so it rebuilds the same result.
  const previous = await previousSnapshot(deps, input)
  const request = buildRequest(deps, { ...input, profile, previous })

  input.progress?.('trading.progress.brief.sections')
  const brief = await capability.run(request)

  logDegradedSections(deps, input, brief.sections)
  input.progress?.('trading.progress.brief.persist')

  return persist(deps, input, {
    sections: [...tryPlanStory(deps, input, { brief, previous }), ...brief.sections],
    caveats,
    scorecardShownThisMonth: request.scorecardShownThisMonth,
    profileRevision: await profileRevisionOf(profile),
  })
}

interface StoryContext {
  readonly brief: MarketBrief
  readonly previous: BriefSnapshot | null
}

/** The story is garnish: a throw costs the brief its two sections, never the brief. An abort is the
 *  caller's. A failed detection and a failed step share one log line, so a reader sees one boundary. */
function tryPlanStory(
  deps: BriefBuildDeps,
  input: BriefBuildInput,
  { brief, previous }: StoryContext
): readonly BriefSectionResult[] {
  const { stories } = brief

  try {
    if (stories.kind === 'failed') {
      logStoryFailed(deps, input, stories.err)

      return []
    }

    return planStory({
      read: stories,
      market: input.market.manifest.id,
      sections: brief.sections,
      previous: previous?.sections ?? null,
      calendar: input.market.manifest.calendar,
      limit: deps.config.briefs.maximumItemsPerSection,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    logStoryFailed(deps, input, err)

    return []
  }
}

function logStoryFailed(deps: BriefBuildDeps, input: BriefBuildInput, err: unknown): void {
  deps.logger.warn('trading.brief_story_failed', { asOf: input.asOf, err: formatErrForLog(err) })
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

  if (!isDeliverable(sections, deps.config.briefs.coreSections)) {
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

  return { kind: 'ready', snapshot, reused: false }
}

/** One line per build, not per section: a builder that throws throws for every name it would have
 *  reported, and the snapshot already carries the caveat a reader sees. */
function logDegradedSections(
  deps: BriefBuildDeps,
  input: BriefBuildInput,
  sections: readonly BriefSectionResult[]
): void {
  const degraded = sections.filter(
    (section) => section.status === 'unavailable' && section.caveats.length > 0
  )

  if (degraded.length > 0) {
    // The codes travel with the section names: the brief runs unattended, and which sections were
    // thin is only half the answer a reader needs the next morning.
    deps.logger.warn('trading.brief_sections_degraded', {
      asOf: input.asOf,
      sections: degraded.map((section) => section.kind),
      codes: [...new Set(degraded.flatMap((section) => section.caveats.map(codeOf)))],
    })
  }
}

function codeOf(caveat: BriefSectionResult['caveats'][number]): string {
  return caveat.code
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

function buildRequest(deps: BriefBuildDeps, input: RequestInput): MarketBriefRequest {
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
    budget: deps.createSuggestionBudget(),
    ...(input.progress === undefined ? {} : { progress: input.progress }),
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
