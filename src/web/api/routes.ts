import type { ActivityResponse, ResearchResponse } from '@/app/server/wire/activity'
import type { AgentDeletedWire, AgentDetailWire, AgentsResponse } from '@/app/server/wire/agents'
import type {
  ChatHistoryResponse,
  ChatRecentResponse,
  ChatSessionDeletedWire,
  ChatSessionsResponse,
} from '@/app/server/wire/chat'
import type {
  ConfigResponse,
  ConfigValidation,
  ConfigWriteResult,
  ProviderCatalogResponse,
  ProviderTestResult,
} from '@/app/server/wire/config'
import type { DebateWire } from '@/app/server/wire/debate'
import type { DigestWire } from '@/app/server/wire/digest'
import type { LiveSnapshotWire, RunCallsWire, RunStopWire } from '@/app/server/wire/live'
import type {
  AlertDisableResponse,
  AlertsResponse,
  AlertWire,
  InstrumentSearchResponse,
  MacroResponse,
  MarketsResponse,
  OverviewResponse,
  ScreenResponse,
  SectorsResponse,
  SourcesResponse,
} from '@/app/server/wire/market'
import type { ModelsResponse } from '@/app/server/wire/models'
import type {
  LedgerPageResponse,
  LedgerWriteResponse,
  RebalanceResponse,
  StopsResponse,
  VenuesResponse,
} from '@/app/server/wire/money'
import type { BoardResponse, NoticesReadResponse, NoticesResponse } from '@/app/server/wire/notices'
import type { OutboundResponse } from '@/app/server/wire/outbound'
import type {
  BrowserSessionEndResult,
  BrowserSessionList,
  BrowserSignInResult,
  PairingDecisionResult,
  PairingList,
  PairingRevokeResult,
} from '@/app/server/wire/sign-in'
import type {
  BriefScheduleWire,
  Capabilities,
  CommandList,
  CostReport,
  DoctorReport,
  HealthResponse,
  RestartAcceptedWire,
  ScheduleRow,
  StatePayload,
} from '@/app/server/wire/system'
import type { TasksResponse } from '@/app/server/wire/tasks'
import type {
  SuggestionCardResponse,
  TradingBriefResponse,
  TradingEventsResponse,
  TradingNavResponse,
  TradingNewsResponse,
  TradingOhlcvResponse,
  TradingPortfolioResponse,
  TradingProfileResponse,
  TradingQuotesResponse,
  TradingSuggestionsResponse,
  TradingTrackRecordResponse,
} from '@/app/server/wire/trading'
import type { WatchlistUpdateResponse } from '@/app/server/wire/watchlist'

/** A `/v1` path tagged with the wire shape it answers, so `getJson` returns that shape. */
export interface RouteDef<T> {
  readonly path: string
  /** The `state.capabilities` flag that says the daemon runs this route. */
  readonly capability?: keyof Capabilities
  // Never set: it carries `T` so a call infers the response type from the route.
  readonly response?: T
}

/** What `POST /v1/respond` and the pause and resume of an agent or a job answer. */
interface OkAnswer {
  readonly ok: true
}

export const ROUTES = Object.freeze({
  health: route<HealthResponse>('/v1/health'),
  state: route<StatePayload>('/v1/state'),
  live: route<LiveSnapshotWire>('/v1/live'),
  notices: route<NoticesResponse>('/v1/notices'),
  noticesRead: route<NoticesReadResponse>('/v1/notices/read'),
  tasks: route<TasksResponse>('/v1/tasks'),
  activity: route<ActivityResponse>('/v1/activity'),
  cost: route<CostReport>('/v1/cost'),
  respond: route<OkAnswer>('/v1/respond'),
  runStop: (runId: string) => route<RunStopWire>(`/v1/runs/${encodeURIComponent(runId)}/stop`),
  runCalls: (runId: string) => route<RunCallsWire>(`/v1/runs/${encodeURIComponent(runId)}/calls`),
  commands: route<CommandList>('/v1/commands'),
  instruments: route<InstrumentSearchResponse>('/v1/instruments'),
  agents: route<AgentsResponse>('/v1/agents'),
  agentCreate: route<AgentDetailWire>('/v1/agents'),
  // GET reads the agent, PATCH replaces it: both answer the agent as it now stands.
  agentDetail: (agentId: string) =>
    route<AgentDetailWire>(`/v1/agents/${encodeURIComponent(agentId)}`),
  agentDelete: (agentId: string) =>
    route<AgentDeletedWire>(`/v1/agents/${encodeURIComponent(agentId)}`),
  agentPause: (agentId: string) =>
    route<OkAnswer>(`/v1/agents/${encodeURIComponent(agentId)}/pause`),
  agentResume: (agentId: string) =>
    route<OkAnswer>(`/v1/agents/${encodeURIComponent(agentId)}/resume`),
  models: route<ModelsResponse>('/v1/models'),
  jobs: route<ScheduleRow>('/v1/jobs'),
  jobAction: (jobId: string, action: 'pause' | 'resume') =>
    route<OkAnswer>(`/v1/jobs/${encodeURIComponent(jobId)}/${action}`),
  board: route<BoardResponse>('/v1/board'),
  digest: route<DigestWire>('/v1/digest'),
  sectors: route<SectorsResponse>('/v1/sectors'),
  chatRecent: route<ChatRecentResponse>('/v1/chat/recent'),
  chatHistory: (sessionId: string) =>
    route<ChatHistoryResponse>(`/v1/chat/history/${encodeURIComponent(sessionId)}`),
  chatSessions: route<ChatSessionsResponse>('/v1/chat/sessions'),
  chatSessionDelete: (sessionId: string) =>
    route<ChatSessionDeletedWire>(`/v1/chat/sessions/${encodeURIComponent(sessionId)}`),
  overview: route<OverviewResponse>('/v1/overview'),
  markets: route<MarketsResponse>('/v1/markets'),
  quotes: route<TradingQuotesResponse>('/v1/quotes', 'quotes'),
  portfolio: route<TradingPortfolioResponse>('/v1/portfolio', 'portfolio'),
  portfolioNav: route<TradingNavResponse>('/v1/portfolio/nav', 'portfolio'),
  ledger: route<LedgerPageResponse>('/v1/ledger', 'portfolio'),
  ledgerWrite: route<LedgerWriteResponse>('/v1/ledger', 'portfolio'),
  ledgerRow: (entryId: string) =>
    route<LedgerWriteResponse>(`/v1/ledger/${encodeURIComponent(entryId)}`, 'portfolio'),
  rebalance: route<RebalanceResponse>('/v1/rebalance', 'portfolio'),
  stops: route<StopsResponse>('/v1/stops', 'portfolio'),
  suggestions: route<TradingSuggestionsResponse>('/v1/suggestions', 'suggestions'),
  suggestionCard: (suggestionId: string) =>
    route<SuggestionCardResponse>(
      `/v1/suggestions/${encodeURIComponent(suggestionId)}/card`,
      'suggestions'
    ),
  suggestionDebate: (suggestionId: string) =>
    route<DebateWire>(`/v1/suggestions/${encodeURIComponent(suggestionId)}/debate`, 'suggestions'),
  screen: route<ScreenResponse>('/v1/screen'),
  trackRecord: route<TradingTrackRecordResponse>('/v1/track-record', 'suggestions'),
  research: route<ResearchResponse>('/v1/research'),
  macro: route<MacroResponse>('/v1/macro'),
  ohlcv: route<TradingOhlcvResponse>('/v1/ohlcv', 'ohlcv'),
  events: route<TradingEventsResponse>('/v1/events', 'ohlcv'),
  news: route<TradingNewsResponse>('/v1/news'),
  brief: route<TradingBriefResponse>('/v1/brief'),
  briefSchedule: route<BriefScheduleWire>('/v1/brief'),
  providers: route<ProviderCatalogResponse>('/v1/providers'),
  providersTest: route<ProviderTestResult>('/v1/providers/test'),
  config: route<ConfigResponse>('/v1/config'),
  configWrite: route<ConfigWriteResult>('/v1/config'),
  configValidate: route<ConfigValidation>('/v1/config/validate'),
  pairing: route<PairingList>('/v1/pairing'),
  pairingDecision: route<PairingDecisionResult>('/v1/pairing'),
  pairingDelete: (channel: string, chatId: string) =>
    route<PairingRevokeResult>(
      `/v1/pairing/${encodeURIComponent(channel)}/${encodeURIComponent(chatId)}`
    ),
  sessionExchange: route<BrowserSignInResult>('/v1/session'),
  sessionLogout: route<BrowserSessionEndResult>('/v1/session/logout'),
  sessions: route<BrowserSessionList>('/v1/sessions'),
  sessionEnd: (sessionId: string) =>
    route<BrowserSessionEndResult>(`/v1/sessions/${encodeURIComponent(sessionId)}`),
  sources: route<SourcesResponse>('/v1/sources'),
  outbound: route<OutboundResponse>('/v1/outbound'),
  doctor: route<DoctorReport>('/v1/doctor'),
  restart: route<RestartAcceptedWire>('/v1/restart'),
  venues: route<VenuesResponse>('/v1/venues', 'portfolio'),
  profile: route<TradingProfileResponse>('/v1/profile'),
  watchlist: route<WatchlistUpdateResponse>('/v1/watchlist'),
  alerts: route<AlertsResponse>('/v1/alerts'),
  alertCreate: route<AlertWire>('/v1/alerts'),
  alertRow: (alertId: string) =>
    route<AlertDisableResponse>(`/v1/alerts/${encodeURIComponent(alertId)}`),
})

function route<T>(path: string, capability?: keyof Capabilities): RouteDef<T> {
  return capability === undefined ? { path } : { path, capability }
}
