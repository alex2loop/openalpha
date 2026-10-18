import type { AuthorizationRequest, AuthProvider, OAuthTokens, StoredTokens } from '@/ai/api'
import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import {
  AUTH_PROVIDERS,
  authProviderByLoginName,
  awaitLoopbackCode,
  createTokenFile,
  loginNames,
} from '@/ai/api'
import { createCommand, createGroup, type Group } from '@/cli/command'
import { terminalErrorMessage, usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { flagBool, flagString } from '@/cli/parsing/args'
import { fail, success } from '@/cli/ui/colors'
import { defaultPrompt } from '@/cli/ui/prompt'
import { BRAND } from '@/core/brand'
import { OperatorConfigError } from '@/core/config/resolve'
import { t } from '@/i18n'
import { formatInstant } from '@/trading/api'

const UNKNOWN_PLAN = 'unknown'
const LOGIN_TIMEOUT_MS = 15 * 60_000
const PROVIDER_SPEC = {
  positional: ['provider'],
  flags: {
    paste: { type: 'boolean', describe: { key: 'cliHelp.flagAuthPaste' } },
    device: { type: 'boolean', describe: { key: 'cliHelp.flagAuthDevice' } },
  },
} as const

const authLoginCommand = createCommand({
  name: 'login',
  summary: { key: 'cliHelp.authLoginSummary' },
  // Reads only the resolved data dir and locale, so it runs before a config file exists: logging in
  // is what makes a subscription model entry usable, and must not require one to already be written.
  needs: { boot: false, configFile: 'optional' },
  spec: PROVIDER_SPEC,
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const authProvider = resolveProvider(args)

    if (authProvider === undefined) {
      return usage(app, buildUnknownLoginProviderMessage(args, locale))
    }

    try {
      const tokens = await login(authProvider, args, app)

      await createTokenFile(app.config.paths.dataDir, authProvider.id).write(tokens)
      app.out(success(t(locale, 'cli.authLoginSuccess', describe(authProvider, tokens))))

      return 0
    } catch (err: unknown) {
      app.err(fail(t(locale, 'cli.authLoginFailed', { reason: terminalErrorMessage(err, locale) })))

      return 1
    }
  },
})

const authStatusCommand = createCommand({
  name: 'status',
  summary: { key: 'cliHelp.authStatusSummary' },
  needs: { boot: false, configFile: 'optional' },
  spec: { positional: ['provider'], positionalOptional: true },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const name = flagString(args, 'provider')
    const now = Date.now()

    if (name === undefined) {
      for (const authProvider of AUTH_PROVIDERS) {
        app.out(await statusLine(authProvider, app, now))
      }

      return 0
    }

    const authProvider = authProviderByLoginName(name)

    if (authProvider === undefined) {
      return usage(app, buildUnknownLoginProviderMessage(args, locale))
    }

    app.out(await statusLine(authProvider, app, now))

    return 0
  },
})

const authLogoutCommand = createCommand({
  name: 'logout',
  summary: { key: 'cliHelp.authLogoutSummary' },
  needs: { boot: false, configFile: 'optional' },
  spec: { positional: ['provider'] },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const authProvider = resolveProvider(args)

    if (authProvider === undefined) {
      return usage(app, buildUnknownLoginProviderMessage(args, locale))
    }

    await createTokenFile(app.config.paths.dataDir, authProvider.id).clear()
    app.out(success(t(locale, 'cli.authLogoutDone', { provider: authProvider.loginName })))

    return 0
  },
})

export const authCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.auth,
  subcommands: [authLoginCommand, authStatusCommand, authLogoutCommand],
})

async function login(
  authProvider: AuthProvider,
  args: ParsedArgs,
  app: CliApp
): Promise<StoredTokens> {
  const locale = app.config.locale.language
  const signal = AbortSignal.timeout(LOGIN_TIMEOUT_MS)
  const paste = flagBool(args, 'paste')
  const device = flagBool(args, 'device')

  if (paste && device) {
    throw new OperatorConfigError('choose either --paste or --device', {
      key: 'cli.authLoginModeConflict',
    })
  }

  if (device) {
    return withClaims(authProvider, await deviceLogin(authProvider, { app, signal }), locale)
  }

  const request = authProvider.createAuthorizationRequest()
  const tokens = paste
    ? await pasteLogin(authProvider, request, { app, signal })
    : await browserLogin(authProvider, request, { app, signal })

  return withClaims(authProvider, tokens, locale)
}

interface LoginContext {
  readonly app: CliApp
  readonly signal: AbortSignal
}

async function deviceLogin(authProvider: AuthProvider, ctx: LoginContext): Promise<OAuthTokens> {
  const locale = ctx.app.config.locale.language
  const withDeviceCode = authProvider.loginWithDeviceCode

  if (withDeviceCode === undefined) {
    throw new OperatorConfigError(`${authProvider.loginName} has no device-code login`, {
      key: 'cli.authDeviceUnsupported',
      params: { provider: authProvider.loginName },
    })
  }

  return await withDeviceCode({
    signal: ctx.signal,
    deadline: Date.now() + LOGIN_TIMEOUT_MS,
    onPrompt: (prompt) => {
      ctx.app.out(
        t(locale, 'cli.authLoginDeviceCode', {
          code: prompt.userCode,
          url: prompt.verificationUrl,
        })
      )
    },
  })
}

// No listener to bind, so the first registered port is the one the pasted redirect will carry.
async function pasteLogin(
  authProvider: AuthProvider,
  request: AuthorizationRequest,
  ctx: LoginContext
): Promise<OAuthTokens> {
  const locale = ctx.app.config.locale.language
  const port = authProvider.callbackPorts[0] ?? 0

  ctx.app.out(t(locale, 'cli.authLoginUrl', { url: authProvider.authorizationUrl(request, port) }))

  const pasted = await defaultPrompt()(t(locale, 'cli.authLoginPastePrompt'), {
    signal: ctx.signal,
  })

  const callback = parsePastedCallback(pasted, locale)

  if (callback.state !== undefined && callback.state !== request.state) {
    throw new OperatorConfigError('login redirect state does not match', {
      key: 'cli.authLoginStateMismatch',
    })
  }

  return await authProvider.exchangeCode({
    code: callback.code,
    verifier: request.verifier,
    redirectUri: authProvider.redirectUri(port),
    signal: ctx.signal,
  })
}

async function browserLogin(
  authProvider: AuthProvider,
  request: AuthorizationRequest,
  ctx: LoginContext
): Promise<OAuthTokens> {
  const locale = ctx.app.config.locale.language
  let redirectUri = ''

  const code = await awaitLoopbackCode({
    signal: ctx.signal,
    state: request.state,
    ports: authProvider.callbackPorts,
    path: authProvider.callbackPath,
    successHtml: page(t(locale, 'cli.authLoginPageOk')),
    errorHtml: page(t(locale, 'cli.authLoginPageError')),
    onListening: (port) => {
      redirectUri = authProvider.redirectUri(port)
      ctx.app.out(
        t(locale, 'cli.authLoginUrl', { url: authProvider.authorizationUrl(request, port) })
      )
      ctx.app.out(t(locale, 'cli.authLoginWaiting'))
    },
  })

  return await authProvider.exchangeCode({
    code,
    verifier: request.verifier,
    redirectUri,
    signal: ctx.signal,
  })
}

function page(message: string): string {
  return `<!doctype html><title>${BRAND.display}</title><p>${message}`
}

// A bare code carries no state and is taken as pasted; a redirect URL without this request's state
// is refused.
function parsePastedCallback(
  input: string,
  _locale: Locale
): { readonly code: string; readonly state?: string } {
  const trimmed = input.trim()

  if (!trimmed.includes('://')) {
    return { code: trimmed }
  }

  const url = new URL(trimmed)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (code === null || code === '') {
    throw new OperatorConfigError('login redirect has no authorization code', {
      key: 'cli.authLoginCodeMissing',
    })
  }

  if (state === null || state === '') {
    throw new OperatorConfigError('login redirect state does not match', {
      key: 'cli.authLoginStateMismatch',
    })
  }

  return { code, state }
}

function withClaims(
  authProvider: AuthProvider,
  tokens: OAuthTokens,
  _locale: Locale
): StoredTokens {
  const claims = authProvider.parseClaims(tokens.accessToken)

  if (claims === undefined) {
    throw new OperatorConfigError(`${authProvider.loginName} sign-in returned no account id`, {
      key: 'cli.authClaimsMissing',
      params: { provider: authProvider.loginName },
    })
  }

  return { ...tokens, ...claims }
}

async function statusLine(authProvider: AuthProvider, app: CliApp, now: number): Promise<string> {
  const locale = app.config.locale.language
  const tokens = await createTokenFile(app.config.paths.dataDir, authProvider.id).read()

  if (tokens === undefined) {
    return t(locale, 'cli.authStatusLoggedOut', { provider: authProvider.loginName })
  }

  if (tokens.expiresAt <= now) {
    return t(locale, 'cli.authStatusExpired', { provider: authProvider.loginName })
  }

  return t(locale, 'cli.authStatusLoggedIn', {
    ...accountAndPlan(tokens),
    provider: authProvider.loginName,
    expires: formatInstant(locale, tokens.expiresAt, app.config.locale.timezone),
  })
}

function resolveProvider(args: ParsedArgs): AuthProvider | undefined {
  const name = flagString(args, 'provider')

  return name === undefined ? undefined : authProviderByLoginName(name)
}

function buildUnknownLoginProviderMessage(args: ParsedArgs, locale: Locale): string {
  return t(locale, 'cli.authProviderUnknown', {
    provider: flagString(args, 'provider') ?? '',
    supported: loginNames().join(', '),
  })
}

function describe(authProvider: AuthProvider, tokens: StoredTokens): Record<string, string> {
  return { provider: authProvider.loginName, ...accountAndPlan(tokens) }
}

function accountAndPlan(tokens: StoredTokens): { account: string; plan: string } {
  return { account: tokens.email ?? tokens.accountId, plan: tokens.planType ?? UNKNOWN_PLAN }
}
