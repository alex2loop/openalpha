import type { Server, ServerWebSocket, WebSocketHandler } from 'bun'

import type { LiveFeed } from '@/app/server/feed/live'
import type { SignInCodes } from '@/app/server/http/sign-in-codes'
import type { ExecSocketData, SocketData, WsData, WsServices } from '@/app/server/ws/socket'
import type { ApiHandle, ApiRouteContext } from '@/app/types'
import type { App } from '@/core/container'
import { SHUTDOWN_DRAIN_MS } from '@/app/daemon'
import { admitExec, closeExecAdmission } from '@/app/server/exec/admission'
import { closeAllExecs, execHandlers } from '@/app/server/exec/connection'
import {
  isOriginAllowed,
  LOOPBACK_HOST,
  PROXY_HEADERS,
  resolvePageOrigin,
  resolvePeerKey,
} from '@/app/server/http/auth'
import { SET_COOKIE, toSessionCookieName } from '@/app/server/http/caller'
import { apiError, handleHttp, resolveAuthorizedCaller } from '@/app/server/http/dispatch'
import { PAGE_ROUTES, toPageResponse } from '@/app/server/http/page'
import { EXEC_PATH } from '@/app/server/wire/exec'
import { SOCKET_IDLE_TIMEOUT_SECONDS } from '@/app/server/wire/socket'
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
import { settleWithin } from '@/core/utils/concurrency'
import { t } from '@/i18n'

const WS_PATH = '/v1/ws'
const API_PREFIX = '/v1/'
const CROSS_SITE = 'cross-site'
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
      // Bun's pings stay on (`sendPings`), so an idle forwarded REPL is not reaped as a dead peer.
      websocket: {
        ...socketHandlers,
        maxPayloadLength: MAX_WS_FRAME_BYTES,
        idleTimeout: SOCKET_IDLE_TIMEOUT_SECONDS,
      },
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
      closeExecAdmission()
      stopListening().catch((err: unknown) => {
        app.resolve('logger').warn('api.admission_close_failed', { err: formatErrForLog(err) })
      })
    },
    stop: async (): Promise<void> => {
      // Sockets first: a client holding one open would otherwise keep the server from closing.
      closeAllExecs()
      closeAllSockets()
      await stopRequests(app, server, stopListening())
    },
  }
}

// In-flight requests get SHUTDOWN_DRAIN_MS to finish, so storage is not closed under one; a request
// still open then (a stalled body) is cut so it cannot hold the stop past its deadline.
async function stopRequests(
  app: App,
  server: Server<SocketData>,
  listening: Promise<void>
): Promise<void> {
  if (await settleWithin(listening, SHUTDOWN_DRAIN_MS)) {
    await listening

    return
  }

  app.resolve('logger').warn('api.stop_forced', { graceMs: SHUTDOWN_DRAIN_MS })
  await server.stop(true)
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
  srv: Server<SocketData>,
  deps: RouteDeps
): Response | undefined | Promise<Response | undefined> {
  const { app, wsServices, ...surface } = deps
  const { publicUrl } = app.config.api
  const url = new URL(req.url)

  // Stricter than the page's rules, and checked whole before any of them.
  if (url.pathname === EXEC_PATH) {
    return execUpgradeResponse(req, srv, { app, token: surface.token })
  }

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

  const ip = srv.requestIP(req)?.address ?? null
  const ctx: ApiRouteContext = {
    app,
    ...surface,
    ip,
    peer: resolvePeerKey(req.headers, ip, pageOrigin === publicUrl),
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
function listen(app: App, serve: () => Server<SocketData>): Server<SocketData> {
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
  srv: Server<SocketData>,
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
      kind: 'feed',
      services: wsServices,
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

/** The seat is taken in `open`, which asks again: two handshakes can both pass admission before
 *  either socket opens. */
function execUpgradeResponse(
  req: Request,
  srv: Server<SocketData>,
  deps: { readonly app: App; readonly token: string }
): Response | undefined {
  const { app, token } = deps
  const refusal = admitExec(req, { app, token, ip: srv.requestIP(req)?.address ?? null })

  if (refusal !== undefined) {
    return refusal
  }

  const data: ExecSocketData = { kind: 'exec', app, frameFailureLogged: false, closed: false }

  return srv.upgrade(req, { data }) ? undefined : apiError('invalid_body')
}

// Each handler routes on the socket's kind: the page's feed and chat, or one forwarded command.
const socketHandlers: WebSocketHandler<SocketData> = {
  open(ws): void {
    if (isExecSocket(ws)) {
      execHandlers.open(ws)
    } else if (isFeedSocket(ws)) {
      wsHandlers.open(ws)
    }
  },
  async message(ws, raw): Promise<void> {
    if (isExecSocket(ws)) {
      execHandlers.message(ws, raw)
    } else if (isFeedSocket(ws)) {
      await wsHandlers.message(ws, raw)
    }
  },
  close(ws): void {
    if (isExecSocket(ws)) {
      execHandlers.close(ws)
    } else if (isFeedSocket(ws)) {
      wsHandlers.close(ws)
    }
  },
}

function isFeedSocket(ws: ServerWebSocket<SocketData>): ws is ServerWebSocket<WsData> {
  return ws.data.kind === 'feed'
}

function isExecSocket(ws: ServerWebSocket<SocketData>): ws is ServerWebSocket<ExecSocketData> {
  return ws.data.kind === 'exec'
}

function resolveWsServices(app: App): WsServices {
  return {
    agents: app.resolve('agents'),
    apiOrders: app.config.api.orders,
    bindings: app.resolve('chatBindingStore'),
    browserSessions: app.resolve('browserSessionStore'),
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
