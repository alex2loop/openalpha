import type { AuthOutcome } from '@/app/server/http/auth'
import type { ApiError, ApiErrorCode, UnconfirmedPriceWire } from '@/app/server/wire/errors'
import type { ApiRouteSpec } from '@/app/types'
import type { App } from '@/core/container'
import type { Locale } from '@/core/types/locale'
import { isLoopback, resolveAuthOutcome, resolveBearerCredential } from '@/app/server/http/auth'
import { buildCapabilities } from '@/app/server/http/capabilities'
import { API_ERROR_STATUS } from '@/app/server/wire/errors'
import { missingEnvOf } from '@/core/config/resolve'
import { ChannelError, ConflictError, ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale } from '@/i18n'
import { PriceUnconfirmedError } from '@/trading/api'

const PARAM_PREFIX = ':'

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

export function apiError(
  code: ApiErrorCode,
  message?: string,
  unconfirmedPrice?: UnconfirmedPriceWire
): Response {
  const error = {
    code,
    ...(message === undefined ? {} : { message }),
    ...(unconfirmedPrice === undefined ? {} : { unconfirmedPrice }),
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

export async function handleHttp(
  req: Request,
  ctx: { readonly app: App; readonly token: string; readonly ip: string | null }
): Promise<Response> {
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
    const refusal = resolveAuthRefusal(req, ctx)

    if (refusal !== null) {
      return refusal
    }
  }

  if (isCapabilityDenied(ctx.app, route)) {
    return apiError('unavailable')
  }

  return runHandler(route, req, { app: ctx.app, token: ctx.token })
}

/** The one error boundary for the whole route table. Without it a throwing handler answers with a
 *  Bun-generated 500 carrying a stack trace, which is exactly the leak `wire/errors.ts` forbids:
 *  every non-2xx body is `{ error: { code } }` and never an internal message. */
async function runHandler(
  route: ApiRouteSpec,
  req: Request,
  handlerCtx: { readonly app: App; readonly token: string }
): Promise<Response> {
  const { app } = handlerCtx

  try {
    return await route.handler(req, { app, token: handlerCtx.token })
  } catch (err: unknown) {
    if (req.signal.aborted) {
      throw err
    }

    app.resolve('logger').error('api.handler_failed', {
      method: route.method,
      path: route.path,
      err: formatErrForLog(err),
    })

    return apiError(
      toErrorCode(err),
      operatorText(app.config.locale.language, err),
      unconfirmedPriceOf(err)
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

function unconfirmedPriceOf(err: unknown): UnconfirmedPriceWire | undefined {
  if (!(err instanceof PriceUnconfirmedError)) {
    return undefined
  }

  const { instrument, price, latest } = err

  return {
    instrument: { market: instrument.market, ticker: instrument.ticker },
    price,
    latest: { price: latest.price, at: latest.at },
  }
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

function resolveAuthRefusal(
  req: Request,
  ctx: { readonly token: string; readonly ip: string | null }
): Response | null {
  // One clock read per request: the lockout window and the failure it records must agree.
  const now = Date.now()
  const credential = resolveBearerCredential(req.headers.get('authorization'), ctx.token)

  return toAuthRefusal(resolveAuthOutcome(ctx.ip, credential, now))
}

/** The one place an auth verdict becomes a status. HTTP and the WebSocket upgrade refuse alike, so
 *  a lockout cannot read as a bad token on one surface and a ban on the other. */
export function toAuthRefusal(outcome: AuthOutcome): Response | null {
  if (outcome === 'locked') {
    return apiError('forbidden')
  }

  return outcome === 'ok' ? null : apiError('unauthorized')
}
