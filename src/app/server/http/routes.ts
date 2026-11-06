import type { ApiRouteGroup, ApiRouteTable } from '@/app/types'
import { ACTIVITY_ROUTES } from '@/app/server/routes/activity'
import { AGENT_ROUTES } from '@/app/server/routes/agents'
import { CHAT_ROUTES } from '@/app/server/routes/chat'
import { DEBATE_ROUTES } from '@/app/server/routes/debate'
import { DIGEST_ROUTES } from '@/app/server/routes/digest'
import { INDEX_ROUTES } from '@/app/server/routes/index-reading'
import { MARKET_ROUTES } from '@/app/server/routes/market'
import { MARKET_EXTRA_ROUTES } from '@/app/server/routes/market-extra'
import { MCP_ROUTES } from '@/app/server/routes/mcp'
import { MODEL_ROUTES } from '@/app/server/routes/models'
import { MONEY_ROUTES } from '@/app/server/routes/money'
import { NOTICE_ROUTES } from '@/app/server/routes/notices'
import { PROFILE_SEGMENT_ROUTES } from '@/app/server/routes/profile-segment'
import { RUN_ROUTES } from '@/app/server/routes/runs'
import { SYSTEM_CORE_ROUTES } from '@/app/server/routes/system'
import { TASK_ROUTES } from '@/app/server/routes/tasks'
import { THEME_ROUTES } from '@/app/server/routes/themes'
import { TRADING_ROUTES } from '@/app/server/routes/trading'
import { WATCHLIST_ROUTES } from '@/app/server/routes/watchlist'
import { ConfigError } from '@/core/errors'

// The route groups a surface can take whole. Every one here reaches no Bun or Node API (the
// browser bundle gate proves it), so the daemon and the browser worker compose from the same
// groups; the ones that need the host process live in `daemon-routes.ts`.
export const SYSTEM_CORE_GROUP: ApiRouteGroup = { name: 'system-core', routes: SYSTEM_CORE_ROUTES }
export const ACTIVITY_GROUP: ApiRouteGroup = { name: 'activity', routes: ACTIVITY_ROUTES }
export const RUN_GROUP: ApiRouteGroup = { name: 'runs', routes: RUN_ROUTES }
export const AGENT_GROUP: ApiRouteGroup = { name: 'agents', routes: AGENT_ROUTES }
export const CHAT_GROUP: ApiRouteGroup = { name: 'chat', routes: CHAT_ROUTES }
export const MCP_GROUP: ApiRouteGroup = { name: 'mcp', routes: MCP_ROUTES }
export const MODEL_GROUP: ApiRouteGroup = { name: 'models', routes: MODEL_ROUTES }
export const NOTICE_GROUP: ApiRouteGroup = { name: 'notices', routes: NOTICE_ROUTES }
export const TASK_GROUP: ApiRouteGroup = { name: 'tasks', routes: TASK_ROUTES }
export const WATCHLIST_GROUP: ApiRouteGroup = { name: 'watchlist', routes: WATCHLIST_ROUTES }
export const MONEY_GROUP: ApiRouteGroup = { name: 'money', routes: MONEY_ROUTES }
export const INDEX_GROUP: ApiRouteGroup = { name: 'index', routes: INDEX_ROUTES }

export const MARKET_GROUP: ApiRouteGroup = {
  name: 'market',
  routes: [...MARKET_ROUTES, ...MARKET_EXTRA_ROUTES],
}

// `GET /v1/analyses` sits with the suggestions it reads beside, so a surface that serves one
// serves the other.
export const TRADING_GROUP: ApiRouteGroup = {
  name: 'trading',
  routes: [
    ...TRADING_ROUTES,
    ...PROFILE_SEGMENT_ROUTES,
    ...DEBATE_ROUTES,
    ...DIGEST_ROUTES,
    ...THEME_ROUTES,
  ],
}

// The server owns the FINAL route table, composed as data rather than extended at runtime: an
// `extend('apiRoutes', ...)` step would either reorder the provider list or leave the table mutable
// after boot. Dispatch is first-match-wins, so a duplicate (method, path) would silently shadow a
// route; fail at build instead: an unreachable route is a bug the operator cannot see from outside.
export function buildApiRoutes(groups: readonly ApiRouteGroup[]): ApiRouteTable {
  const seen = new Set<string>()
  const table = groups.flatMap((group) => group.routes)

  for (const route of table) {
    const key = `${route.method} ${route.path}`

    if (seen.has(key)) {
      throw new ConfigError(`duplicate route: ${key}`)
    }

    seen.add(key)
  }

  return table
}
