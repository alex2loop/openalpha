import type { ApiRouteGroup, ApiRouteSpec } from '@/app/types'
import { BROWSER_CONFIG_GROUP } from '@/app/browser/config-routes'
import {
  CHAT_GROUP,
  INDEX_GROUP,
  MARKET_GROUP,
  MONEY_GROUP,
  RUN_GROUP,
  SYSTEM_CORE_GROUP,
  TRADING_GROUP,
  WATCHLIST_GROUP,
} from '@/app/server/http/routes'

/** A path and what is under it; with a `method`, only that method is withheld and the path's reads
 *  stay served (`PATCH /v1/brief` schedules a daemon send, `GET /v1/brief` is the web's). */
interface WithheldRoute {
  readonly path: string
  readonly method?: string
}

/** Routes a group carries that the web does not serve: they are the daemon's (alerts that fire while
 *  the tab is closed, themes, the venue sync) or name a verdict, a stop or a plan (suggestions and
 *  their cards and debates, the track record, the stops, the reconcile) or answer an agent's
 *  approval request (no tool the web's chat may call asks for one). They answer `not_found`, so
 *  the capabilities read off the table read false too. The analyses route stays: it is the web's. */
const WITHHELD_ROUTES: readonly WithheldRoute[] = Object.freeze([
  { path: '/v1/alerts' },
  { path: '/v1/themes' },
  { path: '/v1/stops' },
  { path: '/v1/suggestions' },
  { path: '/v1/track-record' },
  { path: '/v1/ledger/sync' },
  { path: '/v1/reconcile' },
  { path: '/v1/brief', method: 'PATCH' },
  { path: '/v1/respond' },
  { path: '/v1/runs/:runId/calls' },
  { path: '/v1/runs/:runId/timeline' },
])

/** The route groups the web's features need: the market reads, the trading reads (suggestions'
 *  analyses sit beside them), the ledger and the book, the watchlist, the index reads, the status
 *  routes, the run stop (the page's Stop and the jobs list), the stored chat (its sessions and
 *  history), and the config the model tiers are edited through. Every other group (agents, jobs,
 *  orders, sign-in, memory, the host's own) answers `not_found`. */
export const BROWSER_ROUTE_GROUPS: readonly ApiRouteGroup[] = Object.freeze(
  [
    SYSTEM_CORE_GROUP,
    MARKET_GROUP,
    TRADING_GROUP,
    RUN_GROUP,
    CHAT_GROUP,
    MONEY_GROUP,
    WATCHLIST_GROUP,
    INDEX_GROUP,
    BROWSER_CONFIG_GROUP,
  ].map((group) => ({
    name: group.name,
    routes: group.routes.filter((route) => !isWithheld(route)),
  }))
)

function isWithheld(route: ApiRouteSpec): boolean {
  return WITHHELD_ROUTES.some(
    ({ path, method }) =>
      (method === undefined || method === route.method) &&
      (route.path === path || route.path.startsWith(`${path}/`))
  )
}
