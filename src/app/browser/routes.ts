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

/** The route groups the web's features need: the market reads, the trading reads (suggestions'
 *  analyses sit beside them), the ledger and the book, the watchlist, the index reads, the status
 *  routes, and the config the model tiers are edited through. Every other group (chat, agents, jobs,
 *  orders, sign-in, memory, the host's own) answers `not_found`. */
export const BROWSER_ROUTE_GROUPS: readonly ApiRouteGroup[] = Object.freeze([
  SYSTEM_CORE_GROUP,
  MARKET_GROUP,
  TRADING_GROUP,
  MONEY_GROUP,
  WATCHLIST_GROUP,
  INDEX_GROUP,
  BROWSER_CONFIG_GROUP,
])
