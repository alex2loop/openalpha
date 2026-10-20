import type { Server } from 'bun'

import type { WsData, WsServices } from '@/app/server/ws/socket'
import type { ApiHandle } from '@/app/types'
import type { App } from '@/core/container'
import {
  isOriginAllowed,
  resolveAuthOutcome,
  resolveWebSocketCredential,
} from '@/app/server/http/auth'
import { apiError, handleHttp, toAuthRefusal } from '@/app/server/http/dispatch'
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
const LOOPBACK_HOST = '127.0.0.1'
// Bound the buffer/parse cost of HTTP bodies and WS frames before schema validation.
const MAX_HTTP_BODY_BYTES = 2_097_152
const MAX_WS_FRAME_BYTES = 1_048_576
// Above the host's 120 s ceiling for a whole-market read; Bun's 10 s default cut those off.
const IDLE_TIMEOUT_SECONDS = 150

export function startApi(app: App, token: string): ApiHandle {
  const wsServices = resolveWsServices(app)
  const server = listen(app, () =>
    Bun.serve({
      // Loopback-only by construction; the isLoopback check in handleHttp is the second lock.
      hostname: LOOPBACK_HOST,
      port: app.config.api.port,
      maxRequestBodySize: MAX_HTTP_BODY_BYTES,
      idleTimeout: IDLE_TIMEOUT_SECONDS,
      fetch(req, srv): Response | undefined | Promise<Response> {
        const url = new URL(req.url)

        if (url.pathname === WS_PATH) {
          return wsUpgradeResponse(req, srv, { wsServices, token })
        }

        return handleHttp(req, { app, token, ip: srv.requestIP(req)?.address ?? null })
      },
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
  if (!isOriginAllowed(req.headers.get('origin'))) {
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
      closed: false,
    },
  })
    ? undefined
    : apiError('invalid_body')
}

function resolveWsServices(app: App): WsServices {
  return {
    agents: app.resolve('agents'),
    bindings: app.resolve('chatBindingStore'),
    bus: app.resolve('bus'),
    locale: app.config.locale.language,
    logger: app.resolve('logger'),
    runControl: app.resolve('runRegistry'),
    runner: app.resolve('runner'),
    sessionQueue: app.resolve('sessionQueue'),
    sessions: app.resolve('sessionStore'),
    slashDispatcher: app.resolve('slashDispatcher'),
  }
}
