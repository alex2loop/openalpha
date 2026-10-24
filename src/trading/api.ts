// Public API of trading/. Other modules import from here — never from trading/ internals.
// Every export below has a named consumer outside trading/ (app, cli, channels, host/SDK);
// anything without one stays internal until a surface actually needs it.

// ── Host facade ──────────────────────────────────────────────────────────────

export type { BriefText } from '@/trading/features/brief/surface'
export type { RebalanceText } from '@/trading/features/portfolio/render/rebalance-surface'
export type { ReflectText } from '@/trading/features/suggestion/track-record/surface'
export type { TypedPrice } from '@/trading/kernel/surface/surface'
export type { BriefRescheduleView, DayDigestView } from '@/trading/wiring/composition/app-views'
export type { RebalanceView } from '@/trading/wiring/composition/rebalance-views'
export type {
  HeldStopView,
  MarketView,
  ReconcileView,
  ScreenAnswer,
  TradingBriefView,
  TradingHost,
  TradingMacroView,
  TradingMarketsView,
  TradingTrackRecordView,
} from '@/trading/wiring/host/types'
export { PriceUnconfirmedError } from '@/trading/features/market-data/reads/typed-price'
export { TYPED_PRICES } from '@/trading/kernel/surface/surface'
export { MACRO_SCORE_RANGE } from '@/trading/markets/macro-risk'

// ── Boot & composition ───────────────────────────────────────────────────────

// ── Boot & composition ───────────────────────────────────────────────────────

export type { LoadedSourceModule } from '@/trading/sources/plugin-module'
export type { VenueKeyAudit } from '@/trading/wiring/composition/venue-keys'
export { PROFILE_CURRENCY_SQL } from '@/trading/features/profile/store'
export { loadPluginSourceModules } from '@/trading/sources/plugin-module'
export {
  createTradingRegistrationProvider,
  createTradingStoresProvider,
} from '@/trading/wiring/composition/registration'
export { unavailableSources } from '@/trading/wiring/composition/source-registry'
export { auditVenueKeys } from '@/trading/wiring/composition/venue-keys'
export { resolveTradingConfig, TRADING_CONFIG_SECTION } from '@/trading/wiring/config'

// ── Daemon support ───────────────────────────────────────────────────────────

export {
  logRefreshDegradations,
  refreshDegradations,
} from '@/trading/features/market-data/ops/refresh'
export { isBoundaryFailure } from '@/trading/wiring/loop'

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

// ── Contracts ────────────────────────────────────────────────────────────────

export type {
  Alert,
  AlertListPage,
  AlertService,
  DeliveringAlert,
  DisableAlertResult,
} from '@/trading/features/alerts/types'
export type { BriefDelivery, BriefService, BriefSnapshot } from '@/trading/features/brief/types'
export type { LedgerEntry, LedgerWriteResult } from '@/trading/features/ledger/types'
export type { ScreenCard, ScreenCardRow } from '@/trading/features/market-data/render/screen'
export type { MarketDataService, ScreenView } from '@/trading/features/market-data/types'
export type {
  CapRejection,
  ConfirmOutcome,
  ExitOutcome,
  OrphanExit,
  ReconcileReview,
  RestingExitRow,
  StagedOrder,
  TradeStatus,
  UnguardedPosition,
  UnmirroredIntent,
} from '@/trading/features/order/types'
export type { VenueReconciliation } from '@/trading/features/portfolio/folds/reconcile'
export type {
  NavBenchmark,
  NavHistory,
  NavPoint,
  NavWindow,
} from '@/trading/features/portfolio/nav/types'
export type {
  AbsoluteRebalancePlan,
  PortfolioFinding,
  PortfolioService,
  RebalancePlanResult,
  SizedValuedBook,
  ValuedBook,
  ValuedPosition,
  VenueChoice,
} from '@/trading/features/portfolio/types'
export type {
  RoleOutput,
  RoleOutputListener,
} from '@/trading/features/suggestion/debate/types'
export type { SuggestionCard } from '@/trading/features/suggestion/render/card'
export type { DebateView } from '@/trading/features/suggestion/render/debate-view'
export type {
  SuggestionService,
  TrackRecordReflection,
} from '@/trading/features/suggestion/suggestion'
export type { ActedSummary } from '@/trading/features/suggestion/track-record/acted'
export type { AgentFocusRef } from '@/trading/features/suggestion/track-record/agent-record'
export type { ModelRecord } from '@/trading/features/suggestion/track-record/model-record'
export type { TrackRecordReport } from '@/trading/features/suggestion/track-record/types'
export type {
  StoredSuggestion,
  SuggestionId,
  SuggestionListStatus,
  SuggestionOutcome,
  SuggestionRunResult,
} from '@/trading/features/suggestion/types'
export type { Caveat, CaveatCode, CaveatSeverity, HoldReasonCode } from '@/trading/kernel/caveat'
export type { TradingConfig } from '@/trading/kernel/config'
export type { ConvictionBand } from '@/trading/kernel/conviction'
export type {
  AssetClass,
  CurrencyCode,
  InstrumentKind,
  InstrumentMatch,
  InstrumentRef,
  MarketRef,
  Region,
  Ticker,
  TradingDay,
} from '@/trading/kernel/instrument'
export type {
  QuoteBoard,
  QuoteBoardItem,
  ScreenResult,
} from '@/trading/kernel/market/market-capability'
export type {
  Candle,
  MarketEvent,
  MarketEventKind,
  NewsItem,
  Quote,
} from '@/trading/kernel/market/market-data'
export type { MacroRiskView } from '@/trading/kernel/market/market-macro'
export type { MarketDataOverview } from '@/trading/kernel/market/market-overview'
export type {
  AlertCondition,
  AlertId,
  StopCover,
  StopDistance,
} from '@/trading/kernel/operator/alert'
export type { Book, LedgerEntryId } from '@/trading/kernel/operator/book'
export type { BriefSectionKind, BriefSectionResult } from '@/trading/kernel/operator/brief-section'
export type { FocusScope } from '@/trading/kernel/operator/focus'
export type {
  AlertFired,
  AlertFiredListener,
  CallScoredPayload,
  ExitFillPayload,
  HeldNewsPayload,
  IndexDropPayload,
  NoticeKind,
  OrderFill,
  OrderFilledListener,
  TradingNotice,
  TradingNoticeSender,
} from '@/trading/kernel/operator/notice'
export type {
  InvestmentGoal,
  InvestmentHorizon,
  ProfilePatch,
  RiskLevel,
  UserProfile,
} from '@/trading/kernel/operator/profile'
export type {
  SourceFreshness,
  SourceProvenance,
  SourceResult,
  SourceSummary,
} from '@/trading/kernel/source/source-result'
export type { Page } from '@/trading/kernel/store/page'
export type { AgentRecordSummary } from '@/trading/wiring/host/types'
export { DEFAULT_NAV_WINDOW, NAV_WINDOWS } from '@/trading/features/portfolio/nav/types'
export { NOTICE_KINDS } from '@/trading/kernel/operator/notice'

// ── Values ───────────────────────────────────────────────────────────────────

// ── Values ───────────────────────────────────────────────────────────────────

export { renderAlertNotice } from '@/trading/features/alerts/render'
export { parseExitLevel } from '@/trading/features/alerts/types'
export { renderBriefText } from '@/trading/features/brief/render'
export {
  renderHeldNewsNotice,
  renderIndexDropNotice,
} from '@/trading/features/market-data/ops/held-watch-notice'
export { renderIntradayText } from '@/trading/features/market-data/render/intraday'
export { renderEntryFillNotice, renderExitFillNotice } from '@/trading/features/order/fill-notice'
export { MINIMUM_TRACK_RECORD_SAMPLE } from '@/trading/features/suggestion/pipeline/reporting'
export { renderRoleStance, toDebateView } from '@/trading/features/suggestion/render/debate-view'
export { shownCall } from '@/trading/features/suggestion/render/second-opinion'
export { renderCallScoredNotice } from '@/trading/features/suggestion/track-record/scored-notice'
export {
  isUndecidedHold,
  SUGGESTION_LIST_STATUSES,
  suggestionId,
} from '@/trading/features/suggestion/types'
export {
  buildInstrumentKey,
  marketRef,
  region,
  ticker,
  tradingDay,
  venueRef,
} from '@/trading/kernel/instrument'
export { alertId } from '@/trading/kernel/operator/alert'
export { ledgerEntryId } from '@/trading/kernel/operator/book'
export { isBookFocus, resolveRunFocus, validateAgentFocus } from '@/trading/kernel/operator/focus'
export { isBelowMinimumSize } from '@/trading/kernel/venue/catalog'
export { describeCaveat } from '@/trading/render/caveat'
export { formatClock, formatInstant } from '@/trading/render/datetime'
export { renderFocusLabel } from '@/trading/render/focus'
export { toPlainText } from '@/trading/render/fold'
export { formatSignedFixedFraction, resolveRenderContext } from '@/trading/render/format'
export { formatPriceIn, quotedInOf } from '@/trading/render/money'
export { renderLoopQuarantineNotice } from '@/trading/render/quarantine'
export { renderRestatementNotice } from '@/trading/render/restatement'
export { SURFACE_LIMITS } from '@/trading/surface-limits'
export { TRADING_SKILLS } from '@/trading/wiring/catalog/skills'
