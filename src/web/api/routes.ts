import type { ActivityResponse } from '@/app/server/wire/activity'
import type { DigestWire } from '@/app/server/wire/digest'
import type { LiveSnapshotWire, RunStopWire } from '@/app/server/wire/live'
import type { AlertsResponse, MarketsResponse } from '@/app/server/wire/market'
import type { StopsResponse } from '@/app/server/wire/money'
import type { BoardResponse, NoticesReadResponse, NoticesResponse } from '@/app/server/wire/notices'
import type { CostReport, HealthResponse, StatePayload } from '@/app/server/wire/system'
import type { TasksResponse } from '@/app/server/wire/tasks'
import type { TradingOhlcvResponse, TradingSuggestionsResponse } from '@/app/server/wire/trading'

/** A `/v1` path tagged with the wire shape it answers, so `getJson` returns that shape. */
export interface RouteDef<T> {
  readonly path: string
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
  markets: route<MarketsResponse>('/v1/markets'),
  board: route<BoardResponse>('/v1/board'),
  digest: route<DigestWire>('/v1/digest'),
  alerts: route<AlertsResponse>('/v1/alerts'),
  stops: route<StopsResponse>('/v1/stops'),
  suggestions: route<TradingSuggestionsResponse>('/v1/suggestions'),
  ohlcv: route<TradingOhlcvResponse>('/v1/ohlcv'),
})

function route<T>(path: string): RouteDef<T> {
  return { path }
}
