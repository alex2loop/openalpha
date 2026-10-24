import type { Locale } from '@/core/types/locale'
import type { EpochRange } from '@/core/utils/time'
import type { Alert, AlertListPage, DisableAlertResult } from '@/trading/features/alerts/types'
import type { BriefText } from '@/trading/features/brief/surface'
import type { BriefDelivery, BriefSnapshot } from '@/trading/features/brief/types'
import type {
  LedgerDayRange,
  LedgerEntry,
  LedgerWriteResult,
} from '@/trading/features/ledger/types'
import type { ScreenCard } from '@/trading/features/market-data/render/screen'
import type { MarketDescription, ScreenView } from '@/trading/features/market-data/types'
import type {
  ConfirmOutcome,
  ExitLevels,
  ExitOutcome,
  ReconcileReview,
  TradeStatus,
} from '@/trading/features/order/types'
import type { VenueReconciliation } from '@/trading/features/portfolio/folds/reconcile'
import type { NavHistory, NavWindow } from '@/trading/features/portfolio/nav/types'
import type { ReconcileSentences } from '@/trading/features/portfolio/render/reconcile'
import type { PortfolioView } from '@/trading/features/portfolio/render/segment-shares'
import type { VenueChoice } from '@/trading/features/portfolio/venues'
import type { SuggestionCard } from '@/trading/features/suggestion/render/card'
import type { TrackRecordReflection } from '@/trading/features/suggestion/suggestion'
import type {
  AgentFocusRef,
  AgentRecordView,
} from '@/trading/features/suggestion/track-record/agent-record'
import type { ModelRecord } from '@/trading/features/suggestion/track-record/model-record'
import type { ReflectText } from '@/trading/features/suggestion/track-record/surface'
import type {
  StoredSuggestion,
  SuggestionId,
  SuggestionListStatus,
} from '@/trading/features/suggestion/types'
import type {
  CurrencyCode,
  InstrumentKind,
  InstrumentMatch,
  InstrumentRef,
  MarketRef,
  Region,
  Ticker,
  TickerRequest,
  TradingDay,
  VenueRef,
} from '@/trading/kernel/instrument'
import type { QuoteBoard } from '@/trading/kernel/market/market-capability'
import type { Candle, MarketEvent, NewsItem } from '@/trading/kernel/market/market-data'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { MarketDataOverview } from '@/trading/kernel/market/market-overview'
import type {
  AlertCondition,
  AlertId,
  StopCover,
  StopDistance,
} from '@/trading/kernel/operator/alert'
import type { LedgerEntryId } from '@/trading/kernel/operator/book'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { ProfilePatch, UserProfile } from '@/trading/kernel/operator/profile'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { Page } from '@/trading/kernel/store/page'
import type { TypedPrice } from '@/trading/kernel/surface/surface'
import type { QuoteConvention } from '@/trading/render/money'
import type { SURFACE_LIMITS } from '@/trading/surface-limits'
import type { BriefRescheduleView, DayDigestView } from '@/trading/wiring/composition/app-views'
import type { IntradayNext } from '@/trading/wiring/composition/intraday-next'
import type { RebalanceView } from '@/trading/wiring/composition/rebalance-views'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import type {
  SourceStatus,
  TradingSectorsRequest,
  TradingSectorsView,
} from '@/trading/wiring/host/market-types'

interface TradingSignalRequest {
  readonly signal: AbortSignal
}

interface TradingNavRequest extends TradingSignalRequest {
  readonly window: NavWindow
}

export interface ReconcileView {
  readonly venues: readonly VenueReconciliation[]
  readonly text: ReconcileSentences
}

/** One name over a day range: its bars or its corporate events. */
interface TradingInstrumentRangeRequest {
  readonly instrument: InstrumentRef
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
  readonly signal: AbortSignal
}

interface TradingNewsRequest {
  readonly region?: Region
  readonly limit: number
  readonly signal: AbortSignal
}

interface TradingScreenRequest {
  readonly market: MarketRef
  readonly instrumentKind?: InstrumentKind
  readonly limit: number
  readonly signal: AbortSignal
}

interface TradingSearchRequest {
  readonly query: string
  readonly limit: number
  readonly signal: AbortSignal
}

interface TradingAlertsPageRequest {
  readonly cursor?: AlertId
  readonly limit: number
  readonly signal: AbortSignal
}

interface TradingAlertCreateRequest {
  readonly instrument: TickerRequest
  readonly condition: AlertCondition
  readonly threshold: number
  /** Where it fires to: the asking surface's own address. */
  readonly delivery: DeliveryAddress
  readonly typedPrice?: TypedPrice
  /** Refuses a level a live alert already covers, rather than returning that alert. */
  readonly requireNew?: true
  readonly signal: AbortSignal
}

interface TradingAlertDisableRequest {
  readonly alertId: AlertId
  readonly signal: AbortSignal
}

interface TradingRegionRequest {
  readonly region?: Region
  readonly signal: AbortSignal
}

interface TradingProfileUpdateRequest {
  readonly patch: ProfilePatch
  readonly signal: AbortSignal
}

interface TradingSuggestionsRequest {
  readonly status: SuggestionListStatus
  /** The focus whose calls are listed: the operator's own when absent. */
  readonly focusKey?: string
  readonly instrument?: InstrumentRef
  readonly cursor?: SuggestionId
  readonly limit: number
  readonly signal: AbortSignal
}

interface TradingSuggestionCardRequest {
  readonly suggestionId: SuggestionId
  readonly signal: AbortSignal
}

interface TradingBriefRescheduleRequest {
  /** `HH:mm`, read in the market's own timezone. */
  readonly sendTime: string
  readonly signal: AbortSignal
}

interface TradingAgentRecordsRequest {
  /** Every agent to report, each with the focus its `[focus]` configures now. */
  readonly agents: readonly AgentFocusRef[]
  readonly locale: Locale
  readonly signal: AbortSignal
}

/** An agent's record with the lines a terminal prints for it, in the requested language. */
export interface AgentRecordSummary extends AgentRecordView {
  readonly lines: readonly string[]
}

interface TradingDayDigestRequest {
  /** The operator's day, which dates the briefs. */
  readonly day: TradingDay
  /** The same day as instants, which date the calls. */
  readonly range: EpochRange
  /** How many of the day's largest closes to read. */
  readonly limit: number
  readonly signal: AbortSignal
}

interface TradingSuggestionRequest {
  readonly suggestionId: SuggestionId
  readonly signal: AbortSignal
}

interface TradingTrackRecordRequest {
  readonly limit: number
  readonly signal: AbortSignal
}

interface TradingRebalanceRequest {
  /** Sized in place of the saved watchlist for this run only. */
  readonly tickers?: readonly TickerRequest[]
  readonly signal: AbortSignal
}

interface TradingLedgerPageRequest {
  /** A full entry id, as `nextCursor` returns it; the short handle needs the store. */
  readonly cursor?: LedgerEntryId
  readonly range?: LedgerDayRange
  readonly instrument?: InstrumentRef
  readonly limit: number
  readonly signal: AbortSignal
}

/** The draft arrives unparsed: the host owns the one schema that knows the registered markets,
 *  venues and the base currency, so a route never builds its own copy. */
interface TradingLedgerRecordRequest {
  readonly draft: unknown
  /** Stable per user action, so a retried request records one row, not two. */
  readonly idempotencyKey: string
  readonly typedPrice?: TypedPrice
  readonly signal: AbortSignal
}

interface TradingLedgerUpdateRequest {
  readonly entryId: LedgerEntryId
  /** The whole row as it should stand; an edit replaces, it never merges. */
  readonly draft: unknown
  readonly typedPrice?: TypedPrice
  readonly signal: AbortSignal
}

interface TradingLedgerDeleteRequest {
  readonly entryId: LedgerEntryId
  readonly signal: AbortSignal
}

interface TradingOrderTokenRequest {
  /** The staged order's confirmation token, or an unmirrored row's. */
  readonly token: string
  readonly signal: AbortSignal
}

interface TradingSetExitRequest {
  readonly ticker: Ticker
  /** Absent answers only while one venue holds the name. */
  readonly venue?: VenueRef
  readonly exit: ExitLevels
  /** Absent guards the whole position. */
  readonly quantity?: number
  /** Names the operator request; a retry of it carries the same one. */
  readonly requestId: string
}

interface TradingCancelExitRequest {
  readonly ticker: Ticker
  readonly venue?: VenueRef
}

interface TradingHaltRequest {
  readonly halted: boolean
  readonly signal: AbortSignal
}

interface TradingNewsView {
  readonly region: Region
  readonly result: SourceResult<readonly NewsItem[]>
}

/** A screen read with the CLI's own lines for it. */
export interface ScreenAnswer {
  readonly view: ScreenView
  readonly card: ScreenCard
}

/** A holding's planned stop, and who stands behind it at the exchange. `cover` is absent where
 *  nothing could rest: no exchange account, a custodian with no client, or a venue that did not
 *  answer. */
export interface HeldStopView extends StopDistance {
  readonly cover?: StopCover
}

/** One registered market as an app lays it out: its facts, how it prints a price, and its names
 *  in the operator's language. */
export interface MarketView extends MarketDescription, QuoteConvention {
  readonly label: string
  readonly segmentLabel: string
  readonly regionLabel: string
}

/** Every registered market, with the operator's home region: its owner is the default market. */
export interface TradingMarketsView {
  readonly homeRegion: Region
  readonly markets: readonly MarketView[]
}

export interface TradingMacroView {
  readonly region: Region
  readonly result: SourceResult<MacroRiskView>
  /** The CLI's lean sentence; absent with the macro read. */
  readonly lean?: string
  /** Each driver's name in the operator's language, keyed by driver id. */
  readonly labels: Readonly<Record<string, string>>
}

/** The snapshot stores no region - one operator has one - so the resolved region travels beside
 *  it. */
export interface TradingBriefView {
  readonly region: Region
  readonly snapshot: BriefSnapshot | null
  /** The brief's lines as the CLI prints them; null with the snapshot. */
  readonly text: BriefText | null
}

export interface TradingTrackRecordView {
  readonly reflection: TrackRecordReflection
  readonly text: ReflectText
  readonly byModel: readonly ModelRecord[]
}

/** The only trading surface the server sees. It closes over one app-supplied operator identity, so
 *  no request can select or spoof a user — that is why this exists instead of routes calling
 *  services directly. It holds no store, registry, market switch, renderer, cache, or
 *  authorization logic, and every method makes exactly one service call. */
export interface TradingHost {
  getQuotes(signal: AbortSignal): Promise<QuoteBoard>
  getOhlcv(request: TradingInstrumentRangeRequest): Promise<SourceResult<readonly Candle[]>>
  /** Ex-dates, meetings, splits and listings; a market with no event source answers unavailable. */
  getEvents(request: TradingInstrumentRangeRequest): Promise<SourceResult<readonly MarketEvent[]>>
  getNews(request: TradingNewsRequest): Promise<TradingNewsView>
  /** The board and the lines `/screen` prints for it. */
  screen(request: TradingScreenRequest): Promise<ScreenAnswer>
  searchInstruments(request: TradingSearchRequest): Promise<readonly InstrumentMatch[]>
  getOverview(signal: AbortSignal): Promise<readonly MarketDataOverview[]>
  getMacroRisk(request: TradingRegionRequest): Promise<TradingMacroView>
  describeMarkets(): TradingMarketsView
  /** The market's sectors, strongest first; a market that files none answers empty with a caveat. */
  getSectors(request: TradingSectorsRequest): Promise<TradingSectorsView>
  /** Every source's health as this process has seen it. */
  listSources(): readonly SourceStatus[]
  getProfile(signal: AbortSignal): Promise<UserProfile>
  updateProfile(request: TradingProfileUpdateRequest): Promise<UserProfile>
  getPortfolio(request: TradingSignalRequest): Promise<PortfolioView>
  getNavHistory(request: TradingNavRequest): Promise<NavHistory>
  getStopDistances(request: TradingSignalRequest): Promise<readonly HeldStopView[]>
  getRebalance(request: TradingRebalanceRequest): Promise<RebalanceView>
  getReconcile(request: TradingSignalRequest): Promise<ReconcileView>
  listLedger(request: TradingLedgerPageRequest): Promise<Page<LedgerEntry, LedgerEntryId>>
  recordLedger(request: TradingLedgerRecordRequest): Promise<LedgerWriteResult>
  updateLedgerEntry(request: TradingLedgerUpdateRequest): Promise<LedgerWriteResult>
  deleteLedgerEntry(request: TradingLedgerDeleteRequest): Promise<LedgerWriteResult>
  listSuggestions(request: TradingSuggestionsRequest): Promise<Page<StoredSuggestion, SuggestionId>>
  /** The decision card for one stored suggestion, in the operator's language; `null` for an id the
   *  store does not hold. */
  getSuggestionCard(request: TradingSuggestionCardRequest): Promise<SuggestionCard | null>
  /** One stored suggestion as it was written; `null` for an id the store does not hold. */
  getSuggestion(request: TradingSuggestionRequest): Promise<StoredSuggestion | null>
  getTrackRecord(request: TradingTrackRecordRequest): Promise<TradingTrackRecordView>
  /** The calls, briefs and largest closes of one operator day. */
  getDayDigest(request: TradingDayDigestRequest): Promise<DayDigestView>
  /** What each named agent's calls have earned, together and per focus, beside the other agents'. */
  listAgentRecords(request: TradingAgentRecordsRequest): Promise<readonly AgentRecordSummary[]>
  getBrief(request: TradingRegionRequest): Promise<TradingBriefView>
  /** When and where the morning brief is delivered; `null` before one is scheduled. */
  getBriefDelivery(request: TradingSignalRequest): Promise<BriefDelivery | null>
  /** Whether the intraday report is on, and when it next fires. */
  nextIntraday(signal: AbortSignal): Promise<IntradayNext>
  /** Moves the brief's send time and keeps its delivery address; refuses a brief that is off. */
  rescheduleBrief(request: TradingBriefRescheduleRequest): Promise<BriefRescheduleView>
  /** Every venue a trade can be recorded at, with the markets it holds. */
  listVenues(request: TradingSignalRequest): Promise<readonly VenueChoice[]>
  listAlerts(request: TradingAlertsPageRequest): Promise<AlertListPage>
  createAlert(request: TradingAlertCreateRequest): Promise<Alert>
  disableAlert(request: TradingAlertDisableRequest): Promise<DisableAlertResult>
  /** Whether the alert can still fire. */
  isAlertLive(request: TradingAlertDisableRequest): Promise<boolean>
  /** Whether a venue can place orders; every order method below needs one. */
  ordersEnabled(): boolean
  /** Staged orders, resting exits, unguarded positions, fills the book never got, and the halt. */
  getTradeStatus(request: TradingSignalRequest): Promise<TradeStatus>
  /** Places a staged order the operator confirmed. A refused order throws with `/trade`'s words. */
  confirmOrder(request: TradingOrderTokenRequest): Promise<ConfirmOutcome>
  /** False when the token names no staged order still waiting. */
  discardOrder(request: TradingOrderTokenRequest): Promise<boolean>
  setExit(request: TradingSetExitRequest): Promise<ExitOutcome>
  /** False when no exit was resting there. */
  cancelExit(request: TradingCancelExitRequest): Promise<boolean>
  /** Switches buying off or back on; sells, exits and cancels always go out. */
  setBuyingHalted(request: TradingHaltRequest): Promise<void>
  /** Clears the fills the book now holds and lists the rest. */
  reconcileOrders(request: TradingSignalRequest): Promise<ReconcileReview>
  /** The operator says they booked this fill; false when the token names no such row. */
  clearUnmirrored(request: TradingOrderTokenRequest): Promise<boolean>
}

export interface TradingHostDeps {
  /** The shared display bounds. The host is the one owner of the numeric ceiling: a route validates
   *  payload *shape*, and an over-limit value surfaces here as a `ValidationError` the route maps to
   *  400 — rather than two places each holding their own idea of the maximum. */
  readonly limits: typeof SURFACE_LIMITS
  readonly services: TradingServices
  readonly defaultLocale: Locale
  /** The book's currency: a cash row is booked in it, so the ledger draft fills it in. */
  readonly baseCurrency: CurrencyCode
  readonly shutdownSignal: AbortSignal
  readonly requestTimeoutMs: number
  /** For the reads that screen, value or refresh a whole market. */
  readonly slowRequestTimeoutMs: number
}

// Declared here rather than beside `TradingServices`: the host already depends on the aggregate,
// and augmenting from the other direction would close a cycle between the two files.
declare module '@/core/container' {
  interface Services {
    tradingHost: TradingHost
  }
}
