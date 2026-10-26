import { z } from 'zod'

import type { AuthProvider, OAuthTokens } from '@/ai/api'
import type {
  ChatgptAuthStatus,
  ChatgptLoginWire,
  PairingDecisionBody,
  PairingDecisionResult,
  PairingList,
  PairingRevokeResult,
} from '@/app/server/wire/sign-in'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { App } from '@/core/container'
import { authProviderByLoginName, awaitLoopbackCode, createTokenFile } from '@/ai/api'
import { isApiExposed, resolvePublicAddress } from '@/app/server/exposure'
import { apiError, json } from '@/app/server/http/dispatch'
import { isExposedOnDisk } from '@/app/server/routes/config'
import { localeOf, parsePathId, readJsonBody } from '@/app/server/routes/params'
import { BRAND } from '@/core/brand'
import { channelId } from '@/core/channels'
import { ConfigError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale, t } from '@/i18n'

const LOGIN_NAME = 'chatgpt'
/** How long a sign-in waits for the browser or the device code, as the CLI's `auth login` does. */
const LOGIN_TIMEOUT_MS = 15 * 60_000
/** Paired chats listed per channel: a household of operators, never a crowd. */
const MAX_PAIRED_LIST = 200
const LOGIN_BODY = z.object({ method: z.enum(['browser', 'device']) })

type LoginMethod = z.infer<typeof LOGIN_BODY>['method']

interface LoginJob {
  readonly controller: AbortController
  view: ChatgptLoginWire
}

/** One sign-in at a time per daemon; a second one replaces the first. */
const jobs = new WeakMap<App, LoginJob>()

function provider(): AuthProvider {
  const found = authProviderByLoginName(LOGIN_NAME)

  if (found === undefined) {
    throw new ConfigError(`no auth provider named ${LOGIN_NAME}`)
  }

  return found
}

function page(app: App, key: string): string {
  return `<!doctype html><title>${BRAND.display}</title><p>${bindLocale(app.config.locale.language).translate(key)}`
}

/** Resolves once the person has something to act on (the URL, or the device code), and keeps the
 *  sign-in running in the background until it finishes, fails or times out. */
function startLogin(app: App, method: LoginMethod): Promise<void> {
  const authProvider = provider()
  const controller = new AbortController()
  const timeout = AbortSignal.timeout(LOGIN_TIMEOUT_MS)
  const signal = AbortSignal.any([controller.signal, timeout, app.signal])
  const job: LoginJob = { controller, view: { state: 'starting', method } }
  let announce: () => void = () => undefined
  const announced = new Promise<void>((resolve) => {
    announce = resolve
  })

  jobs.get(app)?.controller.abort()
  jobs.set(app, job)

  const tokens =
    method === 'device'
      ? deviceLogin(authProvider, { signal, job, announce })
      : browserLogin(app, authProvider, { signal, job, announce })

  tokens
    // A sign-out or a newer sign-in while this one ran wins: saving now would undo it.
    .then((result) => (jobs.get(app) === job ? saveTokens(app, authProvider, result) : undefined))
    .then(() => {
      if (jobs.get(app) === job) {
        jobs.delete(app)
      }
    })
    .catch((err: unknown) => {
      if (controller.signal.aborted) {
        return
      }

      job.view = { state: 'failed', method, reason: timeout.aborted ? 'timeout' : 'failed' }
      app.resolve('logger').warn('api.chatgpt_login_failed', { err: formatErrForLog(err) })
    })
    .finally(announce)

  return announced
}

interface LoginRun {
  readonly signal: AbortSignal
  readonly job: LoginJob
  announce(): void
}

async function deviceLogin(authProvider: AuthProvider, run: LoginRun): Promise<OAuthTokens> {
  if (authProvider.loginWithDeviceCode === undefined) {
    throw new ConfigError(`${LOGIN_NAME} has no device sign-in`)
  }

  return authProvider.loginWithDeviceCode({
    signal: run.signal,
    deadline: Date.now() + LOGIN_TIMEOUT_MS,
    onPrompt: (prompt) => {
      run.job.view = {
        state: 'waiting',
        method: 'device',
        userCode: prompt.userCode,
        verificationUrl: prompt.verificationUrl,
      }
      run.announce()
    },
  })
}

/** The browser must run on the daemon's own machine: the redirect lands on its loopback port. */
async function browserLogin(
  app: App,
  authProvider: AuthProvider,
  run: LoginRun
): Promise<OAuthTokens> {
  const request = authProvider.createAuthorizationRequest()
  let redirectUri = ''
  const code = await awaitLoopbackCode({
    signal: run.signal,
    state: request.state,
    ports: authProvider.callbackPorts,
    path: authProvider.callbackPath,
    successHtml: page(app, 'cli.authLoginPageOk'),
    errorHtml: page(app, 'cli.authLoginPageError'),
    onListening: (port) => {
      redirectUri = authProvider.redirectUri(port)
      run.job.view = {
        state: 'waiting',
        method: 'browser',
        url: authProvider.authorizationUrl(request, port),
      }
      run.announce()
    },
  })

  return authProvider.exchangeCode({
    code,
    verifier: request.verifier,
    redirectUri,
    signal: run.signal,
  })
}

async function saveTokens(
  app: App,
  authProvider: AuthProvider,
  tokens: OAuthTokens
): Promise<void> {
  const claims = authProvider.parseClaims(tokens.accessToken)

  if (claims === undefined) {
    throw new ConfigError(`${LOGIN_NAME} sign-in returned no account`)
  }

  await createTokenFile(app.config.paths.dataDir, authProvider.id).write({ ...tokens, ...claims })
}

async function readStatus(app: App): Promise<ChatgptAuthStatus> {
  const stored = await createTokenFile(app.config.paths.dataDir, provider().id).read()
  const login = jobs.get(app)?.view

  return {
    signedIn: stored !== undefined,
    ...(stored === undefined
      ? {}
      : {
          account: stored.email ?? stored.accountId,
          ...(stored.planType === undefined ? {} : { plan: stored.planType }),
          accessExpiresAt: stored.expiresAt,
        }),
    ...(login === undefined ? {} : { login }),
  }
}

async function handleChatgptStatus(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  return json(await readStatus(ctx.app))
}

async function handleChatgptLogin(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = LOGIN_BODY.safeParse(await readJsonBody(req))

  if (!parsed.success) {
    return apiError('invalid_body')
  }

  // A sign-in saves a token the daemon's model calls spend on, like a key.
  if (await isExposedOnDisk(ctx)) {
    return apiError(
      'conflict',
      t(localeOf(ctx), 'errors.chatgptServerOnly', {
        url: resolvePublicAddress(ctx),
        brand: BRAND.name,
      })
    )
  }

  await startLogin(ctx.app, parsed.data.method)

  return json(await readStatus(ctx.app))
}

/** Signs out and cancels a sign-in in progress. The next model call reads the missing file. */
async function handleChatgptLogout(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  jobs.get(ctx.app)?.controller.abort()
  jobs.delete(ctx.app)
  await createTokenFile(ctx.app.config.paths.dataDir, provider().id).clear()

  return json(await readStatus(ctx.app))
}

const DECISION_BODY: z.ZodType<PairingDecisionBody> = z.object({
  channel: z.string().min(1),
  code: z.string().min(1),
  decision: z.enum(['approve', 'deny']),
})

async function handlePairingList(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const store = ctx.app.resolve('pairingStore')
  const now = Date.now()
  const perChannel = await Promise.all(
    ctx.app.resolve('channels').map(async ({ id }) => ({
      pending: (await store.listPending(id, now)).map((pending) => ({ channel: id, ...pending })),
      paired: (await store.listPaired(id, MAX_PAIRED_LIST)).map((chatId) => ({
        channel: id,
        chatId,
      })),
    }))
  )

  return json({
    pending: perChannel.flatMap((entry) => entry.pending),
    paired: perChannel.flatMap((entry) => entry.paired),
  } satisfies PairingList)
}

async function handlePairingDecision(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = DECISION_BODY.safeParse(await readJsonBody(req))
  const channel = parsed.success ? parseChannel(parsed.data.channel) : null

  if (!parsed.success || channel === null) {
    return apiError('invalid_body')
  }

  const store = ctx.app.resolve('pairingStore')
  // Codes are minted upper-case; people type them however they like.
  const code = parsed.data.code.toUpperCase()

  if (parsed.data.decision === 'deny') {
    const denied = await store.deny({ code, channel })

    return json(
      (denied ? { ok: true } : { ok: false, reason: 'not_found' }) satisfies PairingDecisionResult
    )
  }

  // Behind `public_url` nobody at the page is known to be the operator, and an approval grants a
  // chat access to the whole agent.
  if (isApiExposed(ctx.app.config.api)) {
    return apiError(
      'conflict',
      t(localeOf(ctx), 'errors.pairingApproveServerOnly', { brand: BRAND.name, code })
    )
  }

  const approval = await store.approve({ code, channel, now: Date.now() })

  return json(
    (approval.ok
      ? { ok: true }
      : { ok: false, reason: approval.reason }) satisfies PairingDecisionResult
  )
}

/** Takes the chat's pairing back: its next message is asked for a code again. */
async function handlePairingRevoke(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const channel = parsePathId(req, channelId, 1)
  // A chat id is whatever the channel calls it; the route match already refuses an empty segment.
  const chatId = parsePathId(req, (raw) => raw)

  if (channel === null || chatId === null) {
    return apiError('invalid_body')
  }

  const revoked = await ctx.app.resolve('pairingStore').revoke({ channel, chatId, now: Date.now() })

  return json({ revoked } satisfies PairingRevokeResult)
}

function parseChannel(raw: string): ReturnType<typeof channelId> | null {
  try {
    return channelId(raw)
  } catch {
    return null
  }
}

export const SIGN_IN_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/auth/chatgpt', auth: true, handler: handleChatgptStatus },
  { method: 'POST', path: '/v1/auth/chatgpt', auth: true, handler: handleChatgptLogin },
  { method: 'DELETE', path: '/v1/auth/chatgpt', auth: true, handler: handleChatgptLogout },
  { method: 'GET', path: '/v1/pairing', auth: true, handler: handlePairingList },
  { method: 'POST', path: '/v1/pairing', auth: true, handler: handlePairingDecision },
  {
    method: 'DELETE',
    path: '/v1/pairing/:channel/:chatId',
    auth: true,
    handler: handlePairingRevoke,
  },
]
