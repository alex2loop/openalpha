import type { Server } from 'bun'

import type { LiveFeed } from '@/app/server/feed/live'
import type { SignInCodes } from '@/app/server/http/sign-in-codes'
import type { WsData, WsServices } from '@/app/server/ws/socket'
import type { ApiHandle, ApiRouteContext } from '@/app/types'
import type { App } from '@/core/container'
import { isOriginAllowed, resolvePageOrigin } from '@/app/server/http/auth'
import { SET_COOKIE, toSessionCookieName } from '@/app/server/http/caller'
import { apiError, handleHttp, resolveAuthorizedCaller } from '@/app/server/http/dispatch'
import { PAGE_ROUTES, toPageResponse } from '@/app/server/http/page'
import {
  closeAllSockets,
  closeSocketAdmission,
  hasSocketRoom,
  MAX_WS_FRAME_BYTES,
  wsHandlers,
} from '@/app/server/ws/socket'
import { BRAND } from '@/core/brand'
import { isErrno, ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'

const WS_PATH = '/v1/ws'
const API_PREFIX = '/v1/'
const CROSS_SITE = 'cross-site'
// Headers a reverse proxy adds; without `public_url` the daemon refuses to be fronted by one.
const PROXY_HEADERS: readonly string[] = ['x-forwarded-for', 'forwarded']
export const LOOPBACK_HOST = '127.0.0.1'
// Bound the buffer/parse cost of HTTP bodies before schema validation.
const MAX_HTTP_BODY_BYTES = 2_097_152
// Above the host's 120 s ceiling for a whole-market read; Bun's 10 s default cut those off.
const IDLE_TIMEOUT_SECONDS = 150

export function startApi(
  app: App,
  surface: { readonly token: string; readonly live: LiveFeed; readonly codes: SignInCodes }
): ApiHandle {
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
      fetch: (req, srv) => routeRequest(req, srv, { app, ...surface, wsServices }),
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
  readonly codes: SignInCodes
  readonly wsServices: WsServices
}

// Every request but the source run's page passes here, so the proxy and Host checks come first.
function routeRequest(
  req: Request,
  srv: Server<WsData>,
  deps: RouteDeps
): Response | undefined | Promise<Response | undefined> {
  const { app, wsServices, ...surface } = deps
  const { publicUrl } = app.config.api
  const url = new URL(req.url)

  if (publicUrl === undefined && PROXY_HEADERS.some((name) => req.headers.has(name))) {
    return apiError('forbidden', t(app.config.locale.language, 'errors.apiBehindProxy'))
  }

  const pageOrigin = resolvePageOrigin(req.headers.get('host'), publicUrl)

  // A DNS-rebinding page names its own host; a cross-site page may not drive `/v1` at all.
  if (pageOrigin === undefined || isCrossSiteApiRequest(req, url.pathname)) {
    return apiError('forbidden')
  }

  const page = toPageResponse(req, url.pathname)

  if (page !== undefined) {
    return page
  }

  const ctx: ApiRouteContext = {
    app,
    ...surface,
    ip: srv.requestIP(req)?.address ?? null,
    pageOrigin,
    cookieName: toSessionCookieName(pageOrigin, publicUrl),
  }

  return url.pathname === WS_PATH
    ? wsUpgradeResponse(req, srv, { ctx, wsServices })
    : handleHttp(req, ctx)
}

/** Native clients send no `Sec-Fetch-Site` and pass. */
function isCrossSiteApiRequest(req: Request, pathname: string): boolean {
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

// Bun upgrades after an await as long as nothing has answered the request yet.
async function wsUpgradeResponse(
  req: Request,
  srv: Server<WsData>,
  deps: { readonly ctx: ApiRouteContext; readonly wsServices: WsServices }
): Promise<Response | undefined> {
  const { ctx, wsServices } = deps

  if (!isOriginAllowed(req.headers.get('origin'), ctx.pageOrigin)) {
    return apiError('forbidden')
  }

  const caller = await resolveAuthorizedCaller(req, ctx)

  if (caller instanceof Response) {
    return caller
  }

  // After auth, so a peer without the token cannot learn whether the daemon is full; right before
  // the upgrade, since the await above let other handshakes in.
  if (!hasSocketRoom()) {
    return apiError('too_many_streams')
  }

  const { browserSessionId, renewCookie } = caller
  const upgraded = srv.upgrade(req, {
    ...(renewCookie === undefined ? {} : { headers: { [SET_COOKIE]: renewCookie } }),
    data: {
      services: wsServices,
      token: ctx.token,
      ...(browserSessionId === undefined ? {} : { browserSessionId }),
      activeRuns: new Map(),
      commandRuns: new Map(),
      steerIds: new Map(),
      closed: false,
    },
  })

  // False when the client went away during the await, or the request was no upgrade at all.
  return upgraded ? undefined : apiError('invalid_body')
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
