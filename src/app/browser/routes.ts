import type { ApiRouteGroup } from '@/app/types'
import { BROWSER_CONFIG_GROUP } from '@/app/browser/config-routes'
import {
  INDEX_GROUP,
  MARKET_GROUP,
  MONEY_GROUP,
  SYSTEM_CORE_GROUP,
  TRADING_GROUP,
  WATCHLIST_GROUP,
} from '@/app/server/http/routes'

/** Routes a group carries that the web does not serve: they are the daemon's (alerts that fire while
 *  the tab is closed, themes, the venue sync) or name a verdict, a stop or a plan (suggestions and
 *  their cards and debates, the track record, the stops, the reconcile). They answer `not_found`, so
 *  the capabilities read off the table read false too. The analyses route stays: it is the web's. */
const WITHHELD_PATHS: readonly string[] = Object.freeze([
  '/v1/alerts',
  '/v1/themes',
  '/v1/stops',
  '/v1/suggestions',
  '/v1/track-record',
  '/v1/ledger/sync',
  '/v1/reconcile',
])

/** The route groups the web's features need: the market reads, the trading reads (suggestions'
 *  analyses sit beside them), the ledger and the book, the watchlist, the index reads, the status
 *  routes, and the config the model tiers are edited through. Every other group (chat, agents, jobs,
 *  orders, sign-in, memory, the host's own) answers `not_found`. */
export const BROWSER_ROUTE_GROUPS: readonly ApiRouteGroup[] = Object.freeze(
  [
    SYSTEM_CORE_GROUP,
    MARKET_GROUP,
    TRADING_GROUP,
    MONEY_GROUP,
    WATCHLIST_GROUP,
    INDEX_GROUP,
    BROWSER_CONFIG_GROUP,
  ].map((group) => ({
    name: group.name,
    routes: group.routes.filter((route) => !isWithheld(route.path)),
  }))
)

function isWithheld(path: string): boolean {
  return WITHHELD_PATHS.some((withheld) => path === withheld || path.startsWith(`${withheld}/`))
}
