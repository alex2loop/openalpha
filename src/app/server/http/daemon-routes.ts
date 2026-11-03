import type { ApiRouteGroup } from '@/app/types'
import {
  ACTIVITY_GROUP,
  AGENT_GROUP,
  CHAT_GROUP,
  INDEX_GROUP,
  MARKET_GROUP,
  MCP_GROUP,
  MODEL_GROUP,
  MONEY_GROUP,
  NOTICE_GROUP,
  RUN_GROUP,
  SYSTEM_CORE_GROUP,
  TASK_GROUP,
  TRADING_GROUP,
  WATCHLIST_GROUP,
} from '@/app/server/http/routes'
import { AGENT_EDIT_ROUTES } from '@/app/server/routes/agent-edit'
import { CONFIG_ROUTES } from '@/app/server/routes/config'
import { CREDENTIAL_ROUTES } from '@/app/server/routes/credentials'
import { JOB_ROUTES } from '@/app/server/routes/jobs'
import { MEMORY_ROUTES } from '@/app/server/routes/memory'
import { ORDER_ROUTES } from '@/app/server/routes/orders'
import { OUTBOUND_ROUTES } from '@/app/server/routes/outbound'
import { RESTART_ROUTES } from '@/app/server/routes/restart'
import { SESSION_ROUTES } from '@/app/server/routes/session'
import { SIGN_IN_ROUTES } from '@/app/server/routes/sign-in'
import { SYSTEM_DAEMON_ROUTES } from '@/app/server/routes/system-daemon'

// The groups that need the host process: key and config files, the sign-in cookie, the restart,
// the shell, the filesystem. A browser worker never takes these.
const SYSTEM_DAEMON_GROUP: ApiRouteGroup = { name: 'system-daemon', routes: SYSTEM_DAEMON_ROUTES }
const RESTART_GROUP: ApiRouteGroup = { name: 'restart', routes: RESTART_ROUTES }
const AGENT_EDIT_GROUP: ApiRouteGroup = { name: 'agent-edit', routes: AGENT_EDIT_ROUTES }
const CONFIG_GROUP: ApiRouteGroup = {
  name: 'config',
  routes: [...CONFIG_ROUTES, ...CREDENTIAL_ROUTES],
}
const SIGN_IN_GROUP: ApiRouteGroup = { name: 'sign-in', routes: SIGN_IN_ROUTES }
const ORDER_GROUP: ApiRouteGroup = { name: 'orders', routes: ORDER_ROUTES }
const OUTBOUND_GROUP: ApiRouteGroup = { name: 'outbound', routes: OUTBOUND_ROUTES }
const JOB_GROUP: ApiRouteGroup = { name: 'jobs', routes: JOB_ROUTES }
const SESSION_GROUP: ApiRouteGroup = { name: 'session', routes: SESSION_ROUTES }
const MEMORY_GROUP: ApiRouteGroup = { name: 'memory', routes: MEMORY_ROUTES }

// Dispatch is first-match-wins, so the order is the daemon's route order from before the groups.
export const DAEMON_ROUTE_GROUPS: readonly ApiRouteGroup[] = [
  SYSTEM_CORE_GROUP,
  SYSTEM_DAEMON_GROUP,
  RESTART_GROUP,
  ACTIVITY_GROUP,
  RUN_GROUP,
  AGENT_GROUP,
  AGENT_EDIT_GROUP,
  CHAT_GROUP,
  CONFIG_GROUP,
  SIGN_IN_GROUP,
  MCP_GROUP,
  TRADING_GROUP,
  WATCHLIST_GROUP,
  MARKET_GROUP,
  INDEX_GROUP,
  MODEL_GROUP,
  MONEY_GROUP,
  NOTICE_GROUP,
  ORDER_GROUP,
  OUTBOUND_GROUP,
  TASK_GROUP,
  JOB_GROUP,
  SESSION_GROUP,
  MEMORY_GROUP,
]
