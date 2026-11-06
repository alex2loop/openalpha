import type { AuthOutcome } from '@/app/server/http/auth'
import type { Caller } from '@/app/server/http/caller'
import type { ApiRouteContext, Authorize, DaemonRequest } from '@/app/types'
import { isAuthLocked, resolveAuthOutcome } from '@/app/server/http/auth'
import { resolveCaller } from '@/app/server/http/caller'
import { apiError } from '@/app/server/http/dispatch'
import { ConfigError } from '@/core/errors'

/** The daemon's `authorize`: the bearer token or the session cookie. HTTP and the socket upgrade
 *  both ask here, so a cookie and a token are judged alike on each. */
export const authorizeDaemonRequest: Authorize = async (req, ctx): Promise<Caller | Response> => {
  const { token, peer, pageOrigin, cookieName } = daemonOf(ctx)
  // One clock read per request: the lockout window, the failure it records and the session's
  // idle cutoff must agree.
  const now = Date.now()
  const caller = await resolveCaller(req, {
    token,
    sessions: ctx.app.resolve('browserSessionStore'),
    pageOrigin,
    cookieName,
    now,
    locked: isAuthLocked(peer, now),
    logger: ctx.app.resolve('logger'),
  })

  return toAuthRefusal(resolveAuthOutcome(peer, caller.credential, now)) ?? caller
}

/** The one place an auth verdict becomes a status. HTTP and the WebSocket upgrade refuse alike, so
 *  a lockout cannot read as a bad token on one surface and a ban on the other. */
export function toAuthRefusal(outcome: AuthOutcome): Response | null {
  if (outcome === 'locked') {
    return apiError('locked')
  }

  return outcome === 'ok' ? null : apiError('unauthorized')
}

/** The daemon's request facts; a route that needs them runs only where the daemon serves it. */
export function daemonOf(ctx: ApiRouteContext): DaemonRequest {
  if (ctx.daemon === undefined) {
    throw new ConfigError('this route is served only by the daemon')
  }

  return ctx.daemon
}
