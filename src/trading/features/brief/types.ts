import type { ChannelId } from '@/core/channels'
import type { BrandTag, RunId, SessionId } from '@/core/ids'
import type { Budget } from '@/core/types/budget'
import type { Locale } from '@/core/types/locale'
import type {
  LeaseToken,
  PositionExitOptions,
  StopDistanceOptions,
} from '@/trading/features/alerts/types'
import type {
  MarketDataDayRangeRequest,
  MarketDataHeadlinesRequest,
  MarketDataPerMarketRequest,
} from '@/trading/features/market-data/types'
import type { RebalancePlanResult } from '@/trading/features/portfolio/types'
import type { SuggestionBatchItem } from '@/trading/features/suggestion/batch-types'
import type { TrackRecordReport } from '@/trading/features/suggestion/track-record/types'
import type {
  ResolvedActionableSuggestion,
  SuggestionRunResult,
} from '@/trading/features/suggestion/types'
import type { Caveat, DeliveryErrorCode } from '@/trading/kernel/caveat'
import type { DebateMode } from '@/trading/kernel/config'
import type { CurrencyCode, InstrumentRef, Region, TradingDay } from '@/trading/kernel/instrument'
import type {
  FuturesBasis,
  QuoteBoard,
  QuoteBoardRequest,
} from '@/trading/kernel/market/market-capability'
import type { NewsItem } from '@/trading/kernel/market/market-data'
import type { MarketDataOverview } from '@/trading/kernel/market/market-overview'
import type { AlertCondition, StopDistance } from '@/trading/kernel/operator/alert'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { MarketNews, SourceResult } from '@/trading/kernel/source/source-result'
import type { OperationTickOptions } from '@/trading/kernel/store/page'
import type { StageReporter } from '@/trading/kernel/surface/tool-progress'
import { buildUuidV7Id, parseUuidV7Id } from '@/trading/kernel/instrument'

type BriefSnapshotId = string & BrandTag<'BriefSnapshotId'>

export const BRIEF_DELIVERY_STATES = Object.freeze(['scheduled', 'delivering', 'disabled'] as const)
export type BriefDeliveryState = (typeof BRIEF_DELIVERY_STATES)[number]

export const BRIEF_SUPPRESSED_REASONS = Object.freeze(['no-deliverable-content'] as const)
type BriefSuppressedReason = (typeof BRIEF_SUPPRESSED_REASONS)[number]

export const DISABLE_BRIEF_RESULTS = Object.freeze([
  'disabled',
  'already-disabled',
  'not-found',
] as const)
export type DisableBriefResult = (typeof DISABLE_BRIEF_RESULTS)[number]

/** Why a subscription was refused. Each is the operator's input meeting the market's calendar or a
 *  send in flight, so they render as an answer rather than surfacing as a failed command. */
const ENABLE_BRIEF_REJECTIONS = Object.freeze([
  'no-brief-capability',
  'send-time-after-open',
  'not-deliverable',
  'delivering',
] as const)
type EnableBriefRejection = (typeof ENABLE_BRIEF_REJECTIONS)[number]

export interface BriefSnapshot {
  readonly id: BriefSnapshotId
  /** The `YYYY-MM` whose monthly scorecard the reader has already seen. Carried forward by every
   *  later snapshot in that month, so a month is settled by the scorecard rendering rather than by
   *  a brief merely happening. */
  readonly scorecardMonth?: string
  readonly asOf: TradingDay
  readonly authoredLocale: Locale
  /** The profile this was built against. Its segment targets, caps and discipline numbers are
   *  printed straight into the sections, so a snapshot written under a different profile answers a
   *  different question and is rebuilt rather than served. */
  readonly profileRevision: string
  readonly sections: readonly BriefSectionResult[]
  readonly caveats: readonly Caveat[]
  readonly createdAt: number
}

export type BriefResult =
  | {
      readonly kind: 'ready'
      readonly snapshot: BriefSnapshot
      readonly reused: boolean
    }
  | { readonly kind: 'suppressed'; readonly reason: BriefSuppressedReason }

/** The single operator's morning brief. No id and no plurality: `region` stays because it selects
 *  the calendar, and `sendTime` is optional because omitting it means "follow `[trading.briefs]`"
 *  rather than freezing today's configured value into the row. */
interface BriefDeliveryBase {
  readonly region: Region
  readonly delivery: DeliveryAddress
  readonly sendTime?: string
  readonly lastDeliveredDay?: TradingDay
}

export type BriefDelivery =
  | (BriefDeliveryBase & {
      readonly state: 'scheduled'
      readonly nextDeliveryDay: TradingDay
      readonly nextDueAt: number
      readonly attempts: number
      readonly lastErrorCode?: DeliveryErrorCode
    })
  | (BriefDeliveryBase & {
      readonly state: 'delivering'
      readonly deliveryDay: TradingDay
      readonly attempts: number
      readonly leaseToken: LeaseToken
      readonly leaseUntil: number
    })
  | (BriefDeliveryBase & { readonly state: 'disabled'; readonly disabledAt: number })

export type ScheduledBriefDelivery = Extract<BriefDelivery, { readonly state: 'scheduled' }>
export type DeliveringBriefDelivery = Extract<BriefDelivery, { readonly state: 'delivering' }>

/** Rejection is an answer, not a failure: the surface renders the reason in the operator's language
 *  instead of a thrown message no locale owns. Enabling yields a scheduled delivery or a reason it
 *  could not, so no surface renders a next-delivery day it might not have. */
export type EnableBriefResult =
  | { readonly kind: 'enabled'; readonly delivery: ScheduledBriefDelivery }
  | { readonly kind: 'rejected'; readonly reason: EnableBriefRejection }

export interface BuildBriefOptions {
  readonly region: Region
  readonly locale: Locale
  readonly now: number
  readonly signal: AbortSignal
  /** Forwarded from the invoking surface; the build reports its stage keys through it. */
  readonly progress?: StageReporter
  /** Rebuilds past today's stored snapshot instead of reusing it. */
  readonly forced?: boolean
  /** The chat that asked, so its footer counts the suggestions the brief runs. */
  readonly billingSessionId?: SessionId
}

export interface GetLatestBriefOptions {
  readonly region: Region
  readonly locale: Locale
  readonly now: number
  readonly signal: AbortSignal
}

export interface EnableBriefOptions {
  readonly region: Region
  readonly delivery: DeliveryAddress
  /** Omitted means "follow `[trading.briefs] send_time`" — the row stores NULL rather than
   *  freezing today's configured value, so editing config later still moves the brief. */
  readonly sendTime?: string
  /** Starts the schedule tomorrow even when the send time is still ahead today: today's brief is
   *  already out, and re-arming it would send a second one. */
  readonly skipToday?: boolean
  readonly now: number
  readonly signal: AbortSignal
}

interface DisableBriefOptions {
  readonly now: number
  readonly signal: AbortSignal
}

export function briefSnapshotId(raw: string): BriefSnapshotId {
  return parseUuidV7Id<BriefSnapshotId>(raw, 'BriefSnapshotId')
}

export function buildBriefSnapshotId(now: number): BriefSnapshotId {
  return buildUuidV7Id<BriefSnapshotId>(now, 'BriefSnapshotId')
}

/** A new send time for the delivery that already exists. It never turns a brief on: `enable` is an
 *  upsert, so a brief that was never enabled or is disabled is refused here instead. */
export type RescheduleBriefResult =
  | { readonly kind: 'rescheduled'; readonly delivery: ScheduledBriefDelivery }
  | {
      readonly kind: 'rejected'
      readonly reason: EnableBriefRejection | 'not-enabled'
    }

export interface RescheduleBriefOptions {
  readonly sendTime: string
  readonly now: number
  readonly signal: AbortSignal
}

export interface BriefService {
  build(options: BuildBriefOptions): Promise<BriefResult>
  getLatest(options: GetLatestBriefOptions): Promise<BriefSnapshot | null>
  /** The one delivery row, or `null` when the brief has never been enabled. */
  find(signal: AbortSignal): Promise<BriefDelivery | null>
  /** Where a brief scheduled from this address would arrive, or undefined when nowhere: the terminal
   *  has no outbound route of its own and resolves to the chat the daemon would use. */
  resolveRecipient(origin: DeliveryAddress): Promise<DeliveryAddress | undefined>
  enable(options: EnableBriefOptions): Promise<EnableBriefResult>
  reschedule(options: RescheduleBriefOptions): Promise<RescheduleBriefResult>
  disable(options: DisableBriefOptions): Promise<DisableBriefResult>
  deliverDue(options: OperationTickOptions): Promise<BriefDeliveryBatch>
}

export interface BriefDeliveryBatch {
  readonly delivered: number
  readonly deferred: number
  readonly suppressed: number
}

export interface ListSinceOptions {
  /** Exclusive lower bound, pushed into SQL so an unrelated hold or an active alert cannot
   *  consume the page. */
  readonly since: number
  readonly limit: number
  readonly signal: AbortSignal
}

interface BriefAdviceOptions {
  readonly now: number
  readonly signal: AbortSignal
}

/** What the delta section reads the last brief with: strictly before the day being built, in the
 *  language it was authored in. Named apart from the store's own options, which key the same read
 *  by column name. */
interface PreviousSectionsOptions {
  readonly before: TradingDay
  readonly locale: Locale
  readonly signal: AbortSignal
}

interface BriefSummaryOptions {
  readonly limit: number
  readonly signal: AbortSignal
}

/** What both level sections print: a name, which side of which level it crossed, and the currency
 *  the two prices are in. Declared here rather than taken from the alerts feature's own rows,
 *  because the brief is what needs the currency and a stored alert row has no market to ask. */
export interface BriefAlertRow {
  readonly instrument: InstrumentRef
  readonly condition: AlertCondition
  readonly threshold: number
  readonly observedPrice: number
  /** Absent for a market the registry does not list, which prints the price bare. */
  readonly currency?: CurrencyCode
}

/** The narrow seam a morning brief needs from the services that own user state. Declared here, by
 *  the consumer, and bound by `app`: the market composes sections and never reaches into a store.
 *  Every method is the *existing* service operation — a brief that summarized its own track record
 *  or re-derived its own drift bands would be a second owner of both rules. */
/** What a brief section supplies to run suggestions. The service owns cooldown and concurrency;
 *  only the debate depth is the caller's, because it is the caller that pays one debate per name. */
interface BriefSuggestionBatchOptions {
  readonly items: readonly SuggestionBatchItem[]
  readonly channel: ChannelId
  readonly billingSessionId: SessionId | null
  readonly parentRunId?: RunId
  readonly budget: Budget
  readonly debateMode?: DebateMode
  readonly now: number
  readonly signal: AbortSignal
  readonly progress?: StageReporter
}

/** What the operator's book is worth right now. Null before the first ledger entry, because a book
 *  that holds nothing has no value to report — zero would read as a loss. */
export interface BookSummary {
  readonly nav: number
  readonly currency: CurrencyCode
  /** Every priced holding's cost against its mark. Unpriced holdings are absent: nothing below
   *  cost can be said of them. */
  readonly positions: readonly BookPositionSummary[]
  /** Each priced holding's mark in its market's own currency, keyed by `buildInstrumentKey`, so a
   *  section that measures a holding against its plan prices it as the headline did. */
  readonly marks: ReadonlyMap<string, number>
}

/** One holding's cost against what it is worth now, in the book's currency. */
export interface BookPositionSummary {
  readonly instrument: InstrumentRef
  readonly costBase: number
  readonly valueBase: number
}

export interface BriefServices {
  listResolvedSuggestions(
    options: ListSinceOptions
  ): Promise<readonly ResolvedActionableSuggestion[]>
  listFiredAlerts(options: ListSinceOptions): Promise<readonly BriefAlertRow[]>
  rebalance(options: BriefAdviceOptions): Promise<RebalancePlanResult>
  bookSummary(options: BriefAdviceOptions): Promise<BookSummary | null>
  /** Every name the operator holds. Refs only: the sections that read this ask a calendar what is
   *  coming for a name, never what it cost. Separate from the watchlist because a held name the
   *  operator never added to it still has ex-dates the brief must not hide. */
  holdings(options: BriefAdviceOptions): Promise<readonly InstrumentRef[]>
  /** The operator's own limits, for the block that restates them. Not a market read: it never
   *  fails over a provider, and a brief without it would state rules it cannot source. */
  profile(options: BriefAdviceOptions): Promise<UserProfile>
  summarize(options: BriefSummaryOptions): Promise<TrackRecordReport>
  quoteBoard(options: QuoteBoardRequest): Promise<QuoteBoard>
  /** Headline levels of every market the operator uses, for the sections that describe markets
   *  they have not named a single instrument in. */
  overview(options: MarketDataPerMarketRequest): Promise<readonly MarketDataOverview[]>
  /** The VN30 future against spot, for the section that reads what the derivatives desk pays. */
  basis(options: MarketDataDayRangeRequest): Promise<SourceResult<FuturesBasis>>
  /** Headlines of every market the operator uses, one entry per market that publishes them - the
   *  same per-market shape as `overview`, so the composer groups both into blocks the same way. */
  marketNews(options: MarketDataHeadlinesRequest): Promise<readonly MarketNews[]>
  /** The releases behind the macro drivers. Market-less, so it heads the markets rather than
   *  sitting inside one. */
  macroNews(options: MarketDataHeadlinesRequest): Promise<SourceResult<readonly NewsItem[]>>
  /** The global economy tape behind no single market. Market-less like `macroNews`. */
  economyNews(options: MarketDataHeadlinesRequest): Promise<SourceResult<readonly NewsItem[]>>
  runSuggestions(options: BriefSuggestionBatchOptions): Promise<readonly SuggestionRunResult[]>
  positionExits(options: PositionExitOptions): Promise<readonly BriefAlertRow[]>
  /** Held names the exit watch is not protecting: no stored plan, or a hold without levels. */
  unwatchedPositions(options: PositionExitOptions): Promise<readonly InstrumentRef[]>
  /** Held names past the window their segment is scored over, with the price gone nowhere. */
  stalePositions(options: StopDistanceOptions): Promise<readonly InstrumentRef[]>
  stopDistances(options: StopDistanceOptions): Promise<readonly StopDistance[]>
  /** The previous brief's sections, for the block that says what changed since. Null when no
   *  earlier snapshot reads in this build's vocabulary. */
  previousSections(options: PreviousSectionsOptions): Promise<readonly BriefSectionResult[] | null>
}
