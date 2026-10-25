import type { ActivityResponse } from '@/app/server/wire/activity'
import type { AgentsResponse } from '@/app/server/wire/agents'
import type {
  ChatHistoryResponse,
  ChatRecentResponse,
  ChatSessionsResponse,
} from '@/app/server/wire/chat'
import type { ProviderCatalogResponse } from '@/app/server/wire/config'
import type { LiveSnapshotWire, RunStopWire } from '@/app/server/wire/live'
import type {
  AlertDisableResponse,
  AlertsResponse,
  AlertWire,
  InstrumentSearchResponse,
  MacroResponse,
  MarketsResponse,
  OverviewResponse,
} from '@/app/server/wire/market'
import type { LedgerPageResponse, RebalanceResponse, StopsResponse } from '@/app/server/wire/money'
import type { NoticesReadResponse, NoticesResponse } from '@/app/server/wire/notices'
import type {
  Capabilities,
  CommandList,
  CostReport,
  HealthResponse,
  StatePayload,
} from '@/app/server/wire/system'
import type { TasksResponse } from '@/app/server/wire/tasks'
import type {
  TradingBriefResponse,
  TradingEventsResponse,
  TradingNavResponse,
  TradingNewsResponse,
  TradingOhlcvResponse,
  TradingPortfolioResponse,
  TradingProfileResponse,
  TradingQuotesResponse,
  TradingSuggestionsResponse,
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

/** What `POST /v1/respond` answers. */
interface RespondAnswer {
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
  respond: route<RespondAnswer>('/v1/respond'),
  runStop: (runId: string) => route<RunStopWire>(`/v1/runs/${encodeURIComponent(runId)}/stop`),
  commands: route<CommandList>('/v1/commands'),
  instruments: route<InstrumentSearchResponse>('/v1/instruments'),
  agents: route<AgentsResponse>('/v1/agents'),
  chatRecent: route<ChatRecentResponse>('/v1/chat/recent'),
  chatHistory: (sessionId: string) =>
    route<ChatHistoryResponse>(`/v1/chat/history/${encodeURIComponent(sessionId)}`),
  chatSessions: route<ChatSessionsResponse>('/v1/chat/sessions'),
  overview: route<OverviewResponse>('/v1/overview'),
  markets: route<MarketsResponse>('/v1/markets'),
  quotes: route<TradingQuotesResponse>('/v1/quotes', 'quotes'),
  portfolio: route<TradingPortfolioResponse>('/v1/portfolio', 'portfolio'),
  portfolioNav: route<TradingNavResponse>('/v1/portfolio/nav', 'portfolio'),
  ledger: route<LedgerPageResponse>('/v1/ledger', 'portfolio'),
  rebalance: route<RebalanceResponse>('/v1/rebalance', 'portfolio'),
  stops: route<StopsResponse>('/v1/stops', 'portfolio'),
  suggestions: route<TradingSuggestionsResponse>('/v1/suggestions', 'suggestions'),
  macro: route<MacroResponse>('/v1/macro'),
  ohlcv: route<TradingOhlcvResponse>('/v1/ohlcv', 'ohlcv'),
  events: route<TradingEventsResponse>('/v1/events', 'ohlcv'),
  news: route<TradingNewsResponse>('/v1/news'),
  brief: route<TradingBriefResponse>('/v1/brief'),
  providers: route<ProviderCatalogResponse>('/v1/providers'),
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
