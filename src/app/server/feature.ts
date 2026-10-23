import type { ApiHandle, ApiRouteSpec } from '@/app/types'
import type { App, ServiceProvider } from '@/core/container'
import { createLiveFeed, type LiveFeed } from '@/app/server/feed/live'
import { ensureApiToken } from '@/app/server/http/auth'
import { startApi } from '@/app/server/http/server'
import { startIdeaWatch } from '@/app/server/push/ideas'
import { attachAppSurface } from '@/app/server/push/notices'
import { ACTIVITY_ROUTES } from '@/app/server/routes/activity'
import { AGENT_ROUTES } from '@/app/server/routes/agents'
import { CHAT_ROUTES } from '@/app/server/routes/chat'
import { CONFIG_ROUTES } from '@/app/server/routes/config'
import { MARKET_ROUTES } from '@/app/server/routes/market'
import { MCP_ROUTES } from '@/app/server/routes/mcp'
import { MONEY_ROUTES } from '@/app/server/routes/money'
import { NOTICE_ROUTES } from '@/app/server/routes/notices'
import { ORDER_ROUTES } from '@/app/server/routes/orders'
import { SIGN_IN_ROUTES } from '@/app/server/routes/sign-in'
import { SYSTEM_ROUTES } from '@/app/server/routes/system'
import { TRADING_ROUTES } from '@/app/server/routes/trading'
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
  ...ACTIVITY_ROUTES,
  ...AGENT_ROUTES,
  ...CHAT_ROUTES,
  ...CONFIG_ROUTES,
  ...SIGN_IN_ROUTES,
  ...MCP_ROUTES,
  ...TRADING_ROUTES,
  ...MARKET_ROUTES,
  ...MONEY_ROUTES,
  ...NOTICE_ROUTES,
  ...ORDER_ROUTES,
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

    bind('apiStarter', () => async (app, env) => {
      const token = await ensureApiToken(app.config, env)
      const live = startLiveFeed(app)
      let server: ApiHandle | undefined
      let detachAppSurface: (() => void) | undefined

      // The port can be taken, and a failure after it is bound must release it, or the next start
      // finds it taken. Either way no bus listener of the feed outlives the failed start.
      try {
        const api = startApi(app, token, live)

        server = api
        detachAppSurface = attachAppSurface(app)
        const stopIdeaWatch = startIdeaWatch(app)

        return {
          closeAdmission: api.closeAdmission,
          stop: async () => {
            await stopIdeaWatch()
            detachAppSurface?.()
            live.stop()
            await api.stop()
          },
        }
      } catch (err: unknown) {
        detachAppSurface?.()
        live.stop()
        await stopAfterFailedStart(app, server)

        throw err
      }
    })
  },
}

/** The feed follows the bus; a run is live while the run registry or the command dispatcher holds it. */
function startLiveFeed(app: App): LiveFeed {
  const registry = app.resolve('runRegistry')
  const dispatcher = app.resolve('slashDispatcher')

  return createLiveFeed({
    bus: app.resolve('bus'),
    broadcast,
    locale: app.config.locale.language,
    describeCommand: (name) => {
      const command = dispatcher.all().find((known) => known.name === name)

      return command === undefined
        ? undefined
        : describeCommand(bindLocale(app.config.locale.language), command.description)
    },
    isLive: (runId) =>
      registry.active().some((handle) => handle.identity.runId === runId) ||
      dispatcher.activeCommands().includes(runId),
  })
}

async function stopAfterFailedStart(app: App, server: ApiHandle | undefined): Promise<void> {
  if (server === undefined) {
    return
  }

  try {
    await server.stop()
  } catch (err: unknown) {
    app.resolve('logger').warn('api.start_cleanup_failed', { err: formatErrForLog(err) })
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
