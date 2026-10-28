import type { AuthOutcome } from '@/app/server/http/auth'
import type { Caller } from '@/app/server/http/caller'
import type {
  ApiError,
  ApiErrorCode,
  ApiFieldError,
  UnconfirmedPriceWire,
} from '@/app/server/wire/errors'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { App } from '@/core/container'
import type { Locale } from '@/core/types/locale'
import { isAuthLocked, isLoopback, resolveAuthOutcome } from '@/app/server/http/auth'
import { resolveCaller, SET_COOKIE } from '@/app/server/http/caller'
import { buildCapabilities } from '@/app/server/http/capabilities'
import { toInstrumentWire } from '@/app/server/mappers/trading'
import { API_ERROR_STATUS } from '@/app/server/wire/errors'
import { missingEnvOf } from '@/core/config/resolve'
import { ChannelError, ConflictError, ValidationError } from '@/core/errors'
import { FieldValidationError } from '@/core/field-errors'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale } from '@/i18n'
import { PriceUnconfirmedError } from '@/trading/api'

const PARAM_PREFIX = ':'
const SERVER_ERROR_STATUS = 500

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

interface ApiErrorExtras {
  readonly unconfirmedPrice?: UnconfirmedPriceWire
  readonly fields?: readonly ApiFieldError[]
}

export function apiError(code: ApiErrorCode, message?: string, extras?: ApiErrorExtras): Response {
  const error = {
    code,
    ...(message === undefined ? {} : { message }),
    ...(extras?.unconfirmedPrice === undefined
      ? {}
      : { unconfirmedPrice: extras.unconfirmedPrice }),
    ...(extras?.fields === undefined ? {} : { fields: extras.fields }),
  }

  return Response.json({ error } satisfies ApiError, { status: API_ERROR_STATUS[code] })
}

/** Exact, or segment-by-segment when the route declares `:param` placeholders. */
function isPathMatch(routePath: string, actual: string): boolean {
  if (routePath === actual) {
    return true
  }

  if (!routePath.includes(PARAM_PREFIX)) {
    return false
  }

  const route = routePath.split('/')
  const parts = actual.split('/')

  if (route.length !== parts.length) {
    return false
  }

  return route.every((seg, i) =>
    seg.startsWith(PARAM_PREFIX) ? parts[i] !== '' : seg === parts[i]
  )
}

function isCapabilityDenied(app: App, route: ApiRouteSpec): boolean {
  if (route.capability === undefined) {
    return false
  }

  return !buildCapabilities(app)[route.capability]
}

export async function handleHttp(req: Request, ctx: ApiRouteContext): Promise<Response> {
  // Defence in depth: Bun.serve already binds 127.0.0.1, so a non-loopback peer should be impossible.
  if (!isLoopback(ctx.ip)) {
    return apiError('forbidden')
  }

  const url = new URL(req.url)
  const route = ctx.app
    .resolve('apiRoutes')
    .find((r) => r.method === req.method && isPathMatch(r.path, url.pathname))

  if (route === undefined) {
    return apiError('not_found')
  }

  if (route.auth) {
    return runAuthorized(route, req, ctx)
  }

  return isCapabilityDenied(ctx.app, route) ? apiError('unavailable') : runHandler(route, req, ctx)
}

/** A route behind auth: the bearer token or the session cookie, then the capability, then the
 *  handler with the browser session it came from. */
async function runAuthorized(
  route: ApiRouteSpec,
  req: Request,
  ctx: ApiRouteContext
): Promise<Response> {
  const caller = await resolveAuthorizedCaller(req, ctx)

  if (caller instanceof Response) {
    return caller
  }

  if (isCapabilityDenied(ctx.app, route)) {
    return apiError('unavailable')
  }

  const { browserSessionId, renewCookie } = caller
  const response = await runHandler(route, req, {
    ...ctx,
    ...(browserSessionId === undefined ? {} : { browserSessionId }),
  })

  // A cookie the handler set (sign-out) is the answer; a renewal would overwrite it.
  if (renewCookie !== undefined && !response.headers.has(SET_COOKIE)) {
    response.headers.append(SET_COOKIE, renewCookie)
  }

  return response
}

/** The one error boundary for the whole route table. Without it a throwing handler answers with a
 *  Bun-generated 500 carrying a stack trace, which is exactly the leak `wire/errors.ts` forbids:
 *  every non-2xx body is `{ error: { code } }` and never an internal message. */
async function runHandler(
  route: ApiRouteSpec,
  req: Request,
  handlerCtx: ApiRouteContext
): Promise<Response> {
  const { app } = handlerCtx

  try {
    return await route.handler(req, handlerCtx)
  } catch (err: unknown) {
    if (req.signal.aborted) {
      throw err
    }

    // A stop or restart cut the read short: expected, and the caller reads again once it is back.
    if (app.signal.aborted) {
      app.resolve('logger').info('api.handler_stopped', { method: route.method, path: route.path })

      return apiError('stopping')
    }

    const code = toErrorCode(err)

    // A refusal the handler meant to send is the caller's answer, not a failure of ours.
    if (API_ERROR_STATUS[code] < SERVER_ERROR_STATUS) {
      app.resolve('logger').debug('api.handler_refused', {
        method: route.method,
        path: route.path,
        code,
      })
    } else {
      app.resolve('logger').error('api.handler_failed', {
        method: route.method,
        path: route.path,
        err: formatErrForLog(err),
      })
    }

    return apiError(
      code,
      operatorText(app.config.locale.language, err),
      toErrorExtras(app.config.locale.language, err)
    )
  }
}

/** The runtime's own sentence for a refusal it wrote for the operator, in the operator's language.
 *  Any other error stays a code: its message is for the log, not the screen. */
export function operatorText(locale: Locale, err: unknown): string | undefined {
  const operator = err instanceof ValidationError ? err.operator : missingEnvOf(err)?.operator

  return operator === undefined
    ? undefined
    : bindLocale(locale).translate(operator.key, operator.params)
}

/** What a refusal carries beyond its code and sentence: the price it was measured against, or the
 *  fields it was refused for. */
function toErrorExtras(locale: Locale, err: unknown): ApiErrorExtras {
  if (err instanceof PriceUnconfirmedError) {
    const { instrument, price, latest } = err

    return {
      unconfirmedPrice: {
        instrument: toInstrumentWire(instrument),
        price,
        latest: { price: latest.price, at: latest.at },
      },
    }
  }

  if (err instanceof FieldValidationError) {
    const { translate } = bindLocale(locale)

    return {
      fields: err.fields.map(({ path, message }) => ({
        path,
        message: translate(message.key, message.params),
      })),
    }
  }

  return {}
}

/** A rejected request is the caller's fault and says so; anything else is ours and stays opaque. */
export function toErrorCode(err: unknown): ApiErrorCode {
  if (err instanceof PriceUnconfirmedError) {
    return 'price_unconfirmed'
  }

  if (err instanceof ValidationError) {
    return 'invalid_body'
  }

  if (err instanceof ConflictError) {
    return 'conflict'
  }

  if (missingEnvOf(err) !== undefined) {
    return 'unavailable'
  }

  if (err instanceof Error && err.name === 'TimeoutError') {
    return 'timeout'
  }

  return err instanceof ChannelError ? 'upstream_failed' : 'internal'
}

/** Who sent the request, or the refusal to answer instead. HTTP and the socket upgrade both ask
 *  here, so a cookie and a token are judged alike on each. */
export async function resolveAuthorizedCaller(
  req: Request,
  ctx: Pick<ApiRouteContext, 'app' | 'token' | 'ip' | 'pageOrigin' | 'cookieName'>
): Promise<Caller | Response> {
  // One clock read per request: the lockout window, the failure it records and the session's
  // idle cutoff must agree.
  const now = Date.now()
  const caller = await resolveCaller(req, {
    token: ctx.token,
    sessions: ctx.app.resolve('browserSessionStore'),
    pageOrigin: ctx.pageOrigin,
    cookieName: ctx.cookieName,
    now,
    locked: isAuthLocked(ctx.ip, now),
    logger: ctx.app.resolve('logger'),
  })

  return toAuthRefusal(resolveAuthOutcome(ctx.ip, caller.credential, now)) ?? caller
}

/** The one place an auth verdict becomes a status. HTTP and the WebSocket upgrade refuse alike, so
 *  a lockout cannot read as a bad token on one surface and a ban on the other. */
export function toAuthRefusal(outcome: AuthOutcome): Response | null {
  if (outcome === 'locked') {
    return apiError('forbidden')
  }

  return outcome === 'ok' ? null : apiError('unauthorized')
}
