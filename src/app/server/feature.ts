import type { ApiHandle } from '@/app/types'
import type { App, ServiceProvider } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import { withApiRunLimits } from '@/app/server/exposure'
import { createLiveFeed, type LiveFeed } from '@/app/server/feed/live'
import { ensureApiToken } from '@/app/server/http/auth'
import { DAEMON_ROUTE_GROUPS } from '@/app/server/http/daemon-routes'
import { buildApiRoutes } from '@/app/server/http/routes'
import { startApi } from '@/app/server/http/server'
import { createSignInCodes } from '@/app/server/http/sign-in-codes'
import { startIdeaWatch } from '@/app/server/push/ideas'
import { attachAppSurface } from '@/app/server/push/notices'
import { createDaemonSystemHost } from '@/app/server/routes/system-daemon'
import { broadcast } from '@/app/server/ws/socket'
import { describeCommand } from '@/commands/api'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale } from '@/i18n'

// The HTTP/WS API: the last canonical provider (src/app/providers.ts); the daemon starts it only
// with [api] enabled.
export const apiServiceProvider: ServiceProvider = {
  name: 'api',
  register(bind, extend): void {
    bind('apiRoutes', () => buildApiRoutes(DAEMON_ROUTE_GROUPS))
    bind('systemHost', (app) => createDaemonSystemHost(app))
    bind('apiStarter', () => startApiSurface)
    extend('runner', (runner, app) => withApiRunLimits(runner, app))
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

  // Release order; the port goes last.
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
    const api = startApi(app, { token, live, codes: createSignInCodes(token) })

    server = api
    detachAppSurface = attachAppSurface(app)
    stopIdeaWatch = startIdeaWatch(app)

    return { markReady: api.markReady, closeAdmission: api.closeAdmission, stop: stopAll }
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
    tasks: app.resolve('taskStatus'),
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
