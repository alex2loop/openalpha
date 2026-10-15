import type { ApiHandle, ApiRouteSpec } from '@/app/types'
import type { App, ServiceProvider } from '@/core/container'
import { ensureApiToken } from '@/app/server/http/auth'
import { startApi } from '@/app/server/http/server'
import { startIdeaWatch } from '@/app/server/push/ideas'
import { attachAppSurface } from '@/app/server/push/notices'
import { AGENT_ROUTES } from '@/app/server/routes/agents'
import { CHAT_ROUTES } from '@/app/server/routes/chat'
import { CONFIG_ROUTES } from '@/app/server/routes/config'
import { MARKET_ROUTES } from '@/app/server/routes/market'
import { MCP_ROUTES } from '@/app/server/routes/mcp'
import { MONEY_ROUTES } from '@/app/server/routes/money'
import { ORDER_ROUTES } from '@/app/server/routes/orders'
import { SIGN_IN_ROUTES } from '@/app/server/routes/sign-in'
import { SYSTEM_ROUTES } from '@/app/server/routes/system'
import { TRADING_ROUTES } from '@/app/server/routes/trading'
import { ConfigError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

// The server owns the FINAL route table, composed as data rather than extended at runtime: an
// `extend('apiRoutes', ...)` step would either reorder the provider list or leave the table mutable
// after boot. `assertRouteList` validates the whole composition once, here, not per route module.
const ROUTES = [
  ...SYSTEM_ROUTES,
  ...AGENT_ROUTES,
  ...CHAT_ROUTES,
  ...CONFIG_ROUTES,
  ...SIGN_IN_ROUTES,
  ...MCP_ROUTES,
  ...TRADING_ROUTES,
  ...MARKET_ROUTES,
  ...MONEY_ROUTES,
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
      const server = startApi(app, token)
      let detachAppSurface: (() => void) | undefined

      // Port is bound: a failure from here on must release it, or the next start finds it taken.
      try {
        detachAppSurface = attachAppSurface(app)
        const stopIdeaWatch = startIdeaWatch(app)

        return {
          closeAdmission: server.closeAdmission,
          stop: async () => {
            stopIdeaWatch()
            detachAppSurface?.()
            await server.stop()
          },
        }
      } catch (err: unknown) {
        detachAppSurface?.()
        await stopAfterFailedStart(app, server)

        throw err
      }
    })
  },
}

async function stopAfterFailedStart(app: App, server: ApiHandle): Promise<void> {
  try {
    await server.stop()
  } catch (err: unknown) {
    app.resolve('logger').warn('api.start-cleanup-failed', { err: formatErrForLog(err) })
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
