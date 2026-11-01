import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import type { Credential } from '@/app/server/http/auth'
import type {
  BrowserSessionEndResult,
  BrowserSessionList,
  BrowserSessionWire,
  BrowserSignInBody,
  BrowserSignInCode,
  BrowserSignInResult,
} from '@/app/server/wire/sign-in'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { BrowserSessionRow } from '@/persistence/api'
import { buildSecret, isAuthLocked, resolveAuthOutcome, toSecretHash } from '@/app/server/http/auth'
import {
  buildEndedSessionCookie,
  buildSessionCookie,
  SESSION_IDLE_MS,
  SET_COOKIE,
} from '@/app/server/http/caller'
import { apiError, json, toAuthRefusal } from '@/app/server/http/dispatch'
import { parsePathId, readJsonBody } from '@/app/server/routes/params'
import { closeSocketsOf } from '@/app/server/ws/socket'

const BROWSER_SESSION_LIMIT = 20
const MAX_SIGN_IN_BODY_BYTES = 1_024
const BROWSER_LABEL_MAX_CHARS = 40
const LABEL_SEPARATOR = ', '
const SIGN_IN_BODY: z.ZodType<BrowserSignInBody> = z.object({ code: z.string() })

interface LabelRule {
  readonly name: string
  readonly pattern: RegExp
}

// First match wins, so a name another one's User-Agent also carries comes before it (Edge and
// Opera say Chrome, Chrome says Safari, iOS says Mac OS X, Android says Linux).
const BROWSERS: readonly LabelRule[] = Object.freeze([
  { name: 'Edge', pattern: /Edg\// },
  { name: 'Opera', pattern: /OPR\// },
  { name: 'Firefox', pattern: /Firefox\/|FxiOS\// },
  { name: 'Chrome', pattern: /Chrome\/|CriOS\// },
  { name: 'Safari', pattern: /Safari\// },
])
const SYSTEMS: readonly LabelRule[] = Object.freeze([
  { name: 'iOS', pattern: /iPhone|iPad/ },
  { name: 'Android', pattern: /Android/ },
  { name: 'macOS', pattern: /Mac OS X/ },
  { name: 'Windows', pattern: /Windows/ },
  { name: 'Linux', pattern: /Linux/ },
])

/** A browser session's page asking for a code would let a stolen cookie mint more sessions. */
function handleCode(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  if (ctx.browserSessionId !== undefined) {
    return Promise.resolve(apiError('forbidden'))
  }

  return Promise.resolve(json({ code: ctx.codes.issue(Date.now()) } satisfies BrowserSignInCode))
}

/** A wrong or used code counts toward the lockout like a wrong token; a valid one clears it. While
 *  the lockout holds, the code is refused without being taken. */
async function handleSignIn(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = SIGN_IN_BODY.safeParse(await readJsonBody(req, MAX_SIGN_IN_BODY_BYTES))

  if (!parsed.success) {
    return apiError('invalid_body')
  }

  const now = Date.now()
  const credential = takeCodeCredential(ctx, parsed.data.code, now)
  const refusal = toAuthRefusal(resolveAuthOutcome(ctx.peer, credential, now))

  if (refusal !== null) {
    return refusal
  }

  const secret = buildSecret()
  const row: BrowserSessionRow = {
    id: randomUUID(),
    secretHash: toSecretHash(secret, ctx.token),
    label: toBrowserLabel(req.headers.get('user-agent')),
    createdAt: now,
    lastSeenAt: now,
  }

  await ctx.app
    .resolve('browserSessionStore')
    .insert(row, { idleCutoff: now - SESSION_IDLE_MS, limit: BROWSER_SESSION_LIMIT })

  return withCookie(
    json({ ok: true } satisfies BrowserSignInResult),
    buildSessionCookie(ctx.cookieName, secret, ctx.pageOrigin)
  )
}

function takeCodeCredential(ctx: ApiRouteContext, code: string, now: number): Credential {
  if (isAuthLocked(ctx.peer, now)) {
    return 'locked'
  }

  return ctx.codes.take(code, now) ? 'valid' : 'wrong'
}

async function handleLogout(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = ctx.browserSessionId
  const ended = id !== undefined && (await endSession(ctx, id))

  return withCookie(
    json({ ended } satisfies BrowserSessionEndResult),
    buildEndedSessionCookie(ctx.cookieName, ctx.pageOrigin)
  )
}

async function handleList(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const rows = await ctx.app
    .resolve('browserSessionStore')
    .list(Date.now() - SESSION_IDLE_MS, BROWSER_SESSION_LIMIT)
  const sessions = rows.map(
    (row): BrowserSessionWire => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      current: row.id === ctx.browserSessionId,
    })
  )

  return json({ sessions } satisfies BrowserSessionList)
}

async function handleDelete(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, (raw) => raw)

  if (id === null) {
    return apiError('invalid_body')
  }

  return json({ ended: await endSession(ctx, id) } satisfies BrowserSessionEndResult)
}

/** The row goes first, so a socket closed here cannot be reopened with the same cookie. */
async function endSession(ctx: ApiRouteContext, id: string): Promise<boolean> {
  const ended = await ctx.app.resolve('browserSessionStore').remove(id)

  closeSocketsOf(id)

  return ended
}

function withCookie(response: Response, cookie: string): Response {
  response.headers.set(SET_COOKIE, cookie)

  return response
}

/** "<browser>, <os>" in proper nouns; '' when neither is known (the page names it then). */
function toBrowserLabel(userAgent: string | null): string {
  if (userAgent === null) {
    return ''
  }

  return [BROWSERS, SYSTEMS]
    .map((rules) => rules.find((rule) => rule.pattern.test(userAgent))?.name)
    .filter((name) => name !== undefined)
    .join(LABEL_SEPARATOR)
    .slice(0, BROWSER_LABEL_MAX_CHARS)
}

export const SESSION_ROUTES: readonly ApiRouteSpec[] = [
  {
    method: 'POST',
    path: '/v1/session/code',
    auth: true,
    whileStarting: true,
    handler: handleCode,
  },
  { method: 'POST', path: '/v1/session', auth: false, whileStarting: true, handler: handleSignIn },
  {
    method: 'POST',
    path: '/v1/session/logout',
    auth: true,
    whileStarting: true,
    handler: handleLogout,
  },
  { method: 'GET', path: '/v1/sessions', auth: true, handler: handleList },
  { method: 'DELETE', path: '/v1/sessions/:id', auth: true, handler: handleDelete },
]
