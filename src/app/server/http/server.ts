import type { Server } from 'bun'

import type { LiveFeed } from '@/app/server/feed/live'
import type { WsData, WsServices } from '@/app/server/ws/socket'
import type { ApiHandle } from '@/app/types'
import type { App } from '@/core/container'
import {
  isHostAllowed,
  isOriginAllowed,
  resolveAuthOutcome,
  resolveWebSocketCredential,
} from '@/app/server/http/auth'
import { apiError, handleHttp, toAuthRefusal } from '@/app/server/http/dispatch'
import { PAGE_ROUTES, toPageResponse } from '@/app/server/http/page'
import {
  closeAllSockets,
  closeSocketAdmission,
  hasSocketRoom,
  wsHandlers,
} from '@/app/server/ws/socket'
import { BRAND } from '@/core/brand'
import { isErrno, ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

const WS_PATH = '/v1/ws'
const API_PREFIX = '/v1/'
const CROSS_SITE = 'cross-site'
export const LOOPBACK_HOST = '127.0.0.1'
// Bound the buffer/parse cost of HTTP bodies and WS frames before schema validation.
const MAX_HTTP_BODY_BYTES = 2_097_152
const MAX_WS_FRAME_BYTES = 1_048_576
// Above the host's 120 s ceiling for a whole-market read; Bun's 10 s default cut those off.
const IDLE_TIMEOUT_SECONDS = 150

export function startApi(app: App, token: string, live: LiveFeed): ApiHandle {
  const wsServices = resolveWsServices(app)
  const server = listen(app, () =>
    Bun.serve({
      // Loopback-only by construction. The isLoopback check in handleHttp is a second lock for the
      // /v1 HTTP routes only: the page route and the WS upgrade below never reach it.
      hostname: LOOPBACK_HOST,
      port: app.config.api.port,
      maxRequestBodySize: MAX_HTTP_BODY_BYTES,
      idleTimeout: IDLE_TIMEOUT_SECONDS,
      routes: PAGE_ROUTES,
      fetch: (req, srv) => routeRequest(req, srv, { app, token, live, wsServices }),
      websocket: { ...wsHandlers, maxPayloadLength: MAX_WS_FRAME_BYTES },
      // Bun's default error page is HTML with the stack; every error body here is `{ error: { code } }`.
      development: false,
      error(err): Response {
        app.resolve('logger').error('api.request_failed', { err: formatErrForLog(err) })

        return apiError('internal')
      },
    })
  )

  // `stop(false)` closes the listener at once and resolves when in-flight requests finish.
  let stopping: Promise<void> | undefined
  const stopListening = (): Promise<void> => (stopping ??= server.stop(false))

  return {
    closeAdmission: (): void => {
      closeSocketAdmission()
      stopListening().catch((err: unknown) => {
        app.resolve('logger').warn('api.admission_close_failed', { err: formatErrForLog(err) })
      })
    },
    stop: async (): Promise<void> => {
      // Sockets first: a client holding /v1/ws open would otherwise keep the server from closing.
      closeAllSockets()
      // Resolves once in-flight requests finish, so storage is not closed under one.
      await stopListening()
    },
  }
}

interface RouteDeps {
  readonly app: App
  readonly token: string
  readonly live: LiveFeed
  readonly wsServices: WsServices
}

// Every request but the source run's page passes here, so the Host check comes first.
function routeRequest(
  req: Request,
  srv: Server<WsData>,
  deps: RouteDeps
): Response | undefined | Promise<Response> {
  const { app, token, live, wsServices } = deps
  const url = new URL(req.url)

  if (isForeignRequest(req, url.pathname)) {
    return apiError('forbidden')
  }

  const page = toPageResponse(req, url.pathname)

  if (page !== undefined) {
    return page
  }

  if (url.pathname === WS_PATH) {
    return wsUpgradeResponse(req, srv, { wsServices, token })
  }

  return handleHttp(req, { app, token, live, ip: srv.requestIP(req)?.address ?? null })
}

/** A DNS-rebinding page names its own host; a cross-site page may not drive `/v1` at all. Native
 *  clients send no `Sec-Fetch-Site` and pass. */
function isForeignRequest(req: Request, pathname: string): boolean {
  if (!isHostAllowed(req.headers.get('host'))) {
    return true
  }

  return pathname.startsWith(API_PREFIX) && req.headers.get('sec-fetch-site') === CROSS_SITE
}

/** A taken port is the operator's to fix, so it reads as their sentence, not a crash. */
function listen(app: App, serve: () => Server<WsData>): Server<WsData> {
  try {
    return serve()
  } catch (err: unknown) {
    if (!isErrno(err, 'EADDRINUSE')) {
      throw err
    }

    const port = app.config.api.port

    throw new ValidationError(
      `api port ${port} is in use`,
      { key: 'cli.apiPortInUse', params: { port, brand: BRAND.name } },
      err
    )
  }
}

function wsUpgradeResponse(
  req: Request,
  srv: Server<WsData>,
  ctx: { readonly wsServices: WsServices; readonly token: string }
): Response | undefined {
  if (!isOriginAllowed(req.headers.get('origin'), req.headers.get('host'))) {
    return apiError('forbidden')
  }

  const outcome = resolveAuthOutcome(
    srv.requestIP(req)?.address ?? null,
    resolveWebSocketCredential(req, ctx.token),
    Date.now()
  )
  const refusal = toAuthRefusal(outcome)

  if (refusal !== null) {
    return refusal
  }

  // After auth, so a peer without the token cannot learn whether the daemon is full.
  if (!hasSocketRoom()) {
    return apiError('too_many_streams')
  }

  return srv.upgrade(req, {
    data: {
      services: ctx.wsServices,
      token: ctx.token,
      activeRuns: new Map(),
      commandRuns: new Map(),
      steerIds: new Map(),
      closed: false,
    },
  })
    ? undefined
    : apiError('invalid_body')
}

function resolveWsServices(app: App): WsServices {
  return {
    agents: app.resolve('agents'),
    apiOrders: app.config.api.orders,
    bindings: app.resolve('chatBindingStore'),
    bus: app.resolve('bus'),
    commandLane: app.resolve('commandLane'),
    locale: app.config.locale.language,
    logger: app.resolve('logger'),
    runControl: app.resolve('runRegistry'),
    runner: app.resolve('runner'),
    sessionQueue: app.resolve('sessionQueue'),
    sessions: app.resolve('sessionStore'),
    slashDispatcher: app.resolve('slashDispatcher'),
  }
}
