import type { ApiHandle, ApiRouteSpec } from '@/app/types'
import type { App, ServiceProvider } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import { createLiveFeed, type LiveFeed } from '@/app/server/feed/live'
import { ensureApiToken } from '@/app/server/http/auth'
import { startApi } from '@/app/server/http/server'
import { startIdeaWatch } from '@/app/server/push/ideas'
import { attachAppSurface } from '@/app/server/push/notices'
import { ACTIVITY_ROUTES } from '@/app/server/routes/activity'
import { AGENT_EDIT_ROUTES } from '@/app/server/routes/agent-edit'
import { AGENT_ROUTES } from '@/app/server/routes/agents'
import { CHAT_ROUTES } from '@/app/server/routes/chat'
import { CONFIG_ROUTES } from '@/app/server/routes/config'
import { DEBATE_ROUTES } from '@/app/server/routes/debate'
import { DIGEST_ROUTES } from '@/app/server/routes/digest'
import { JOB_ROUTES } from '@/app/server/routes/jobs'
import { MARKET_ROUTES } from '@/app/server/routes/market'
import { MARKET_EXTRA_ROUTES } from '@/app/server/routes/market-extra'
import { MCP_ROUTES } from '@/app/server/routes/mcp'
import { MODEL_ROUTES } from '@/app/server/routes/models'
import { MONEY_ROUTES } from '@/app/server/routes/money'
import { NOTICE_ROUTES } from '@/app/server/routes/notices'
import { ORDER_ROUTES } from '@/app/server/routes/orders'
import { OUTBOUND_ROUTES } from '@/app/server/routes/outbound'
import { RESTART_ROUTES } from '@/app/server/routes/restart'
import { RUN_ROUTES } from '@/app/server/routes/runs'
import { SIGN_IN_ROUTES } from '@/app/server/routes/sign-in'
import { SYSTEM_ROUTES } from '@/app/server/routes/system'
import { TASK_ROUTES } from '@/app/server/routes/tasks'
import { TRADING_ROUTES } from '@/app/server/routes/trading'
import { WATCHLIST_ROUTES } from '@/app/server/routes/watchlist'
import { broadcast } from '@/app/server/ws/socket'
import { describeCommand } from '@/commands/api'
import { ConfigError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale } from '@/i18n'

// The server owns the FINAL route table, composed as data rather than extended at runtime: an
// `extend('apiRoutes', ...)` step would either reorder the provider list or leave the table mutable
// after boot. `assertRouteList` validates the whole composition once, here, not per route module.
const ROUTES = [
  ...SYSTEM_ROUTES,
  ...RESTART_ROUTES,
  ...ACTIVITY_ROUTES,
  ...RUN_ROUTES,
  ...AGENT_ROUTES,
  ...AGENT_EDIT_ROUTES,
  ...CHAT_ROUTES,
  ...CONFIG_ROUTES,
  ...SIGN_IN_ROUTES,
  ...MCP_ROUTES,
  ...TRADING_ROUTES,
  ...WATCHLIST_ROUTES,
  ...DEBATE_ROUTES,
  ...DIGEST_ROUTES,
  ...MARKET_ROUTES,
  ...MARKET_EXTRA_ROUTES,
  ...MODEL_ROUTES,
  ...MONEY_ROUTES,
  ...NOTICE_ROUTES,
  ...ORDER_ROUTES,
  ...OUTBOUND_ROUTES,
  ...TASK_ROUTES,
  ...JOB_ROUTES,
] as const

// The HTTP/WS API: the last canonical provider (src/app/providers.ts); the daemon starts it only
// with [api] enabled.
export const apiServiceProvider: ServiceProvider = {
  name: 'api',
  register(bind): void {
    bind('apiRoutes', () => {
      assertRouteList(ROUTES)

      return ROUTES
    })

    bind('apiStarter', () => startApiSurface)
  },
}

async function startApiSurface(
  app: App,
  env: Readonly<Record<string, string | undefined>>
): Promise<ApiHandle> {
  const token = await ensureApiToken(app.config, env)
  const live = startLiveFeed(app)
  let server: ApiHandle | undefined
  let detachAppSurface: (() => void) | undefined
  let stopIdeaWatch: (() => Promise<void>) | undefined

  // Release order; the port goes last. Each step runs even when an earlier one throws.
  const stopAll = (): Promise<void> =>
    runStopSteps(app.resolve('logger'), [
      { step: 'ideaWatch', run: () => stopIdeaWatch?.() },
      { step: 'appSurface', run: () => detachAppSurface?.() },
      { step: 'liveFeed', run: () => live.stop() },
      { step: 'api', run: () => server?.stop() },
    ])

  // The port can be taken, and a failure after it is bound must release it, or the next start
  // finds it taken. Either way no bus listener of the feed outlives the failed start.
  try {
    const api = startApi(app, token, live)

    server = api
    detachAppSurface = attachAppSurface(app)
    stopIdeaWatch = startIdeaWatch(app)

    return { closeAdmission: api.closeAdmission, stop: stopAll }
  } catch (err: unknown) {
    await stopAll()

    throw err
  }
}

/** The feed follows the bus; a run is live while the run registry or the command dispatcher holds it. */
function startLiveFeed(app: App): LiveFeed {
  const registry = app.resolve('runRegistry')
  const dispatcher = app.resolve('slashDispatcher')

  return createLiveFeed({
    bus: app.resolve('bus'),
    logger: app.resolve('logger'),
    broadcast,
    locale: app.config.locale.language,
    describeCommand: (name) => {
      const command = dispatcher.all().find((known) => known.name === name)

      return command === undefined
        ? undefined
        : describeCommand(bindLocale(app.config.locale.language), command.description)
    },
    liveRunIds: () =>
      new Set([
        ...registry.active().map((handle) => handle.identity.runId),
        ...dispatcher.activeCommands(),
      ]),
  })
}

interface StopStep {
  readonly step: string
  readonly run: () => void | Promise<void> | undefined
}

// A throwing step is logged and the rest still run: cleanup never throws and never leaves a
// listener or the port behind.
async function runStopSteps(logger: Logger, steps: readonly StopStep[]): Promise<void> {
  for (const { step, run } of steps) {
    try {
      await run()
    } catch (err: unknown) {
      logger.warn('api.stop_step_failed', { step, err: formatErrForLog(err) })
    }
  }
}

// Dispatch is first-match-wins, so a duplicate (method, path) silently shadows a route. Fail at
// boot instead: an unreachable route is a bug the operator cannot see from the outside.
function assertRouteList(routes: readonly ApiRouteSpec[]): void {
  const seen = new Set<string>()

  for (const route of routes) {
    const key = `${route.method} ${route.path}`

    if (seen.has(key)) {
      throw new ConfigError(`duplicate route: ${key}`)
    }

    seen.add(key)
  }
}
