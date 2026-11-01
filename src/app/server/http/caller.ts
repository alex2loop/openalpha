import type { Credential } from '@/app/server/http/auth'
import type { Logger } from '@/core/logging/logger'
import type { BrowserSessionStore } from '@/persistence/api'
import { resolveBearerCredential, toSecretHash } from '@/app/server/http/auth'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_SECOND } from '@/core/utils/time'

export const SESSION_IDLE_MS = 30 * MS_PER_DAY
export const SET_COOKIE = 'Set-Cookie'
/** A session's `lastSeenAt` moves at most this often, so a busy page writes once an hour. */
const SESSION_TOUCH_MS = MS_PER_HOUR
const SESSION_COOKIE_PREFIX = 'oa_session'
// Browsers take a `__Host-` cookie only Secure, on Path=/ and with no Domain, so a sibling
// subdomain of the public host cannot plant one under this name.
const HOST_ONLY_PREFIX = '__Host-'
const DEFAULT_HTTP_PORT = '80'
const SAME_ORIGIN = 'same-origin'
const WEBSOCKET_UPGRADE = 'websocket'
const READ_METHODS: readonly string[] = ['GET', 'HEAD']
const COOKIE_ATTRIBUTES = 'HttpOnly; SameSite=Strict; Path=/'
const SECURE_ATTRIBUTE = '; Secure'
const SECURE_SCHEME = 'https:'

/** Who sent a request: what it offered, the browser session it came from, and the `Set-Cookie`
 *  value to send when that session was just touched. */
export interface Caller {
  readonly credential: Credential
  readonly browserSessionId?: string
  readonly renewCookie?: string
}

const ABSENT: Caller = { credential: 'absent' }

interface CallerDeps {
  readonly token: string
  readonly sessions: BrowserSessionStore
  readonly pageOrigin: string
  readonly cookieName: string
  readonly now: number
  /** The lockout holds, so a bearer token is refused without being compared. */
  readonly locked: boolean
  readonly logger: Logger
}

/** One name per daemon address: a local daemon and a tunnelled one on another port keep separate
 *  cookies, and the one behind `public_url` has its own. */
export function toSessionCookieName(pageOrigin: string, publicUrl: string | undefined): string {
  if (pageOrigin === publicUrl) {
    return `${HOST_ONLY_PREFIX}${SESSION_COOKIE_PREFIX}`
  }

  return `${SESSION_COOKIE_PREFIX}_${new URL(pageOrigin).port || DEFAULT_HTTP_PORT}`
}

/** A bearer header wins when present; any other `Authorization` (a proxy's basic auth) is ignored
 *  and the session cookie is read, accepted only from the page itself. An unknown cookie is
 *  `absent`, so it never counts toward the lockout. A store read that throws is not caught: the
 *  request fails closed. */
export async function resolveCaller(req: Request, deps: CallerDeps): Promise<Caller> {
  const bearer = resolveBearerCredential(req.headers.get('authorization'), deps.token, deps.locked)

  if (bearer !== 'absent') {
    return { credential: bearer }
  }

  const secret = new Bun.CookieMap(req.headers.get('cookie') ?? '').get(deps.cookieName)

  if (secret === null || secret === '' || !isCookieAllowed(req, deps.pageOrigin)) {
    return ABSENT
  }

  const row = await deps.sessions.findBySecret(
    toSecretHash(secret, deps.token),
    deps.now - SESSION_IDLE_MS
  )

  if (row === undefined) {
    return ABSENT
  }

  const caller: Caller = { credential: 'session', browserSessionId: row.id }

  if (deps.now - row.lastSeenAt < SESSION_TOUCH_MS) {
    return caller
  }

  const touched = await isTouched(deps, row.id)

  return touched
    ? { ...caller, renewCookie: buildSessionCookie(deps.cookieName, secret, deps.pageOrigin) }
    : caller
}

/** The cookie is sent by any page of the same site, so it counts only on a request the page made
 *  itself; a write and the socket also need its Origin. */
function isCookieAllowed(req: Request, pageOrigin: string): boolean {
  const origin = req.headers.get('origin')

  if (req.headers.get('upgrade')?.toLowerCase() === WEBSOCKET_UPGRADE) {
    return origin === pageOrigin
  }

  if (req.headers.get('sec-fetch-site') !== SAME_ORIGIN) {
    return false
  }

  return READ_METHODS.includes(req.method) || origin === pageOrigin
}

// A failed touch costs only the renewal: the session stays valid until its idle cutoff.
async function isTouched(deps: CallerDeps, id: string): Promise<boolean> {
  try {
    await deps.sessions.touch(id, deps.now)

    return true
  } catch (err: unknown) {
    deps.logger.warn('api.session_touch_failed', { err: formatErrForLog(err) })

    return false
  }
}

/** Sent again with a fresh `Max-Age` whenever the session is touched, so the cookie lives as long
 *  as the idle expiry allows. */
export function buildSessionCookie(name: string, secret: string, pageOrigin: string): string {
  return buildCookie(name, secret, { maxAgeMs: SESSION_IDLE_MS, pageOrigin })
}

export function buildEndedSessionCookie(name: string, pageOrigin: string): string {
  return buildCookie(name, '', { maxAgeMs: 0, pageOrigin })
}

function buildCookie(
  name: string,
  value: string,
  options: { readonly maxAgeMs: number; readonly pageOrigin: string }
): string {
  const secure = options.pageOrigin.startsWith(SECURE_SCHEME) ? SECURE_ATTRIBUTE : ''

  return `${name}=${value}; ${COOKIE_ATTRIBUTES}; Max-Age=${options.maxAgeMs / MS_PER_SECOND}${secure}`
}
