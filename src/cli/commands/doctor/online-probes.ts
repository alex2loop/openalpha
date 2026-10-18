import { z } from 'zod'

import type { CredentialSource, ProviderEntry, StoredTokens } from '@/ai/api'
import type { ResolvedConfig, ResolvedModel } from '@/core/config/resolve'
import type { LLMErrorCode } from '@/core/llm'
import type { Locale } from '@/core/types/locale'
import {
  createClient,
  createCredentialSources,
  createTokenFile,
  findProviderById,
  missingKeyErrors,
} from '@/ai/api'
import { resolveSecret, TELEGRAM_API_BASE, ZALO_API_BASE } from '@/channels/api'
import { terminalErrorMessage } from '@/cli/error-output'
import { setEnvCommand, toMissingSearchKeyError } from '@/core/config/resolve'
import { LLMError } from '@/core/errors'
import { httpRequest } from '@/core/http-client'
import { silentLogger } from '@/core/logging/logger'
import { NetworkPolicy } from '@/core/ssrf/network-policy'
import { t } from '@/i18n'
import { formatInstant } from '@/trading/api'

import type { DoctorEnvironment, DoctorProbe, ResolvedProviderModel } from './types'
import { checkLabel, subjectLabel } from './labels'
import { unknownProviderProbe } from './local-probes'

export const ONLINE_TIMEOUT_MS = 10_000
const PROBE_REACHED_CODES: ReadonlySet<LLMErrorCode> = new Set([
  'empty_response',
  'output_budget_exhausted',
])
const UNREACHABLE_CODES: ReadonlySet<LLMErrorCode> = new Set(['transient', 'timeout'])
// Both bot APIs answer `GET /bot<token>/getMe` with an `{ ok }` envelope.
const BOT_API_HOSTS = { telegram: TELEGRAM_API_BASE, zalo: ZALO_API_BASE } as const
const DUCKDUCKGO_HOST = 'https://html.duckduckgo.com'
const TRAILING_SLASH_RE = /\/+$/

const botConfigSchema = z.looseObject({
  enabled: z.boolean().optional(),
  token_env: z.string().optional(),
  token_file: z.string().optional(),
})

const getMeSchema = z.looseObject({ ok: z.boolean() })

type BotChannel = keyof typeof BOT_API_HOSTS

interface BotProbeOptions {
  readonly channel: BotChannel
  readonly config: ResolvedConfig
  readonly env: DoctorEnvironment
  readonly locale: Locale
}

interface ProviderProbeOptions {
  readonly config: ResolvedConfig
  readonly online: boolean
  readonly env: DoctorEnvironment
  readonly locale: Locale
}

export async function probeProviders(
  options: ProviderProbeOptions
): Promise<readonly DoctorProbe[]> {
  const { config, online, env, locale } = options
  const name = checkLabel(locale, 'providers')

  if (config.models.length === 0) {
    return [{ name, status: 'fail', detail: t(locale, 'cli.doctorNoModels') }]
  }

  const loginProbes = await probeSubscriptionLogins(config, locale)

  if (!online) {
    return [{ name, status: 'ok', detail: t(locale, 'cli.doctorNotProbed') }, ...loginProbes]
  }

  const credentials = createCredentialSources({
    dataDir: config.paths.dataDir,
    logger: silentLogger,
    env,
  })
  // An unset key already fails the models row; probing it would report the same cause twice.
  const unset = new Set(missingKeyErrors(config).map((err) => err.env))
  const keyed = config.models.filter(
    (model) => model.missingEnv === undefined || !unset.has(model.missingEnv)
  )
  const keyProbes = await Promise.all(
    firstModelPerProvider(keyed).map((model) =>
      probeProviderKey({ config, model, credentials, locale })
    )
  )

  return [...keyProbes, ...loginProbes]
}

// Reading the token file is a local FS check, not a network call, so it runs whether or not
// --online was passed — driven off authKind, never a vendor id, so a second login provider is
// covered with no change here. `[[models]] provider` is a free string, so an id absent from the
// catalog must degrade to a fail probe, never throw and take the whole doctor report down with it.
async function probeSubscriptionLogins(
  config: ResolvedConfig,
  locale: Locale
): Promise<readonly DoctorProbe[]> {
  const now = Date.now()
  const resolved = firstModelPerProvider(config.models).map((model) => ({
    model,
    provider: findProviderById(model.provider),
  }))
  const unknown = resolved
    .filter((entry) => entry.provider === undefined)
    .map((entry) => unknownProviderProbe(entry.model.provider, entry.model, locale))

  const loginProbes = await Promise.all(
    resolved
      .filter((entry): entry is ResolvedProviderModel => entry.provider !== undefined)
      .filter((entry) => entry.provider.authKind === 'oauth_subscription')
      .map((entry) => probeLogin({ config, provider: entry.provider, now, locale }))
  )

  return [...unknown, ...loginProbes]
}

async function probeLogin(options: {
  readonly config: ResolvedConfig
  readonly provider: ProviderEntry
  readonly now: number
  readonly locale: Locale
}): Promise<DoctorProbe> {
  const { config, provider, now, locale } = options
  const name = subjectLabel(locale, 'login', provider.id)
  let stored: StoredTokens | undefined

  try {
    stored = await createTokenFile(config.paths.dataDir, provider.id).read()
  } catch {
    return {
      name,
      status: 'fail',
      detail: t(locale, 'cli.doctorLoginUnreadable', { provider: provider.id }),
    }
  }

  if (stored === undefined) {
    return {
      name,
      status: 'fail',
      detail: t(locale, 'cli.doctorLoginMissing', { provider: provider.id }),
    }
  }

  if (stored.expiresAt <= now) {
    return {
      name,
      status: 'fail',
      detail: t(locale, 'cli.doctorLoginExpired', { provider: provider.id }),
    }
  }

  return {
    name,
    status: 'ok',
    detail: t(locale, 'cli.doctorLoginOk', {
      provider: provider.id,
      expires: formatInstant(locale, stored.expiresAt, config.locale.timezone),
    }),
  }
}

export async function probeBotTokenCheck(
  options: BotProbeOptions & { readonly online: boolean }
): Promise<readonly DoctorProbe[]> {
  if (options.config.channels[options.channel] === undefined) {
    return []
  }

  if (!options.online) {
    return [
      {
        name: checkLabel(options.locale, options.channel),
        status: 'ok',
        detail: t(options.locale, 'cli.doctorNotProbed'),
      },
    ]
  }

  const row = await probeBotToken(options)

  return row === null ? [] : [row]
}

export async function probeWebSearch(
  config: ResolvedConfig,
  online: boolean,
  locale: Locale
): Promise<DoctorProbe> {
  const { webSearch } = config
  const missing = toMissingSearchKeyError(webSearch)

  if (missing !== undefined) {
    return {
      name: checkLabel(locale, 'web-search'),
      status: 'fail',
      detail: terminalErrorMessage(missing, locale),
    }
  }

  const row = await probeSearchProvider(config, online, locale)

  if (webSearch.fallbackMissingEnv === undefined || row.status === 'fail') {
    return row
  }

  const env = webSearch.fallbackMissingEnv

  return {
    name: row.name,
    status: 'warn',
    detail: t(locale, 'cli.doctorSearchFallbackOff', {
      detail: row.detail,
      env,
      command: setEnvCommand(env),
    }),
  }
}

async function probeSearchProvider(
  config: ResolvedConfig,
  online: boolean,
  locale: Locale
): Promise<DoctorProbe> {
  const search = config.webSearch
  const name = checkLabel(locale, 'web-search')

  if (search.provider === 'duckduckgo') {
    return online
      ? reachProbe({ host: DUCKDUCKGO_HOST, path: '/html/', query: { q: 'ping' }, locale })
      : offlineWebSearchRow(search.provider, locale)
  }

  if (search.provider === 'searxng') {
    if (search.baseUrl === undefined) {
      return { name, status: 'fail', detail: t(locale, 'cli.doctorSearxngRequiresBaseUrl') }
    }

    return online
      ? reachProbe({
          host: search.baseUrl.replace(TRAILING_SLASH_RE, ''),
          path: '/search',
          query: { q: 'ping', format: 'json' },
          locale,
        })
      : offlineWebSearchRow(search.provider, locale)
  }

  if (search.provider === 'anysearch' && search.apiKey === undefined) {
    return {
      name,
      status: 'ok',
      detail: t(locale, 'cli.doctorAnonymousAccess', { provider: search.provider }),
    }
  }

  if (search.apiKey === undefined) {
    return {
      name,
      status: 'fail',
      detail: t(locale, 'cli.doctorApiKeyNotSet', { provider: search.provider }),
    }
  }

  return {
    name,
    status: 'ok',
    detail: t(locale, 'cli.doctorApiKeyPresent', { provider: search.provider }),
  }
}

function firstModelPerProvider(models: readonly ResolvedModel[]): readonly ResolvedModel[] {
  const seen = new Set<string>()
  const out: ResolvedModel[] = []

  for (const model of models) {
    if (!seen.has(model.provider)) {
      seen.add(model.provider)
      out.push(model)
    }
  }

  return out
}

async function probeProviderKey(options: {
  readonly config: ResolvedConfig
  readonly model: ResolvedModel
  readonly credentials: readonly CredentialSource[]
  readonly locale: Locale
}): Promise<DoctorProbe> {
  const { config, model, credentials, locale } = options

  try {
    const chain = createClient({
      models: [model],
      tuning: config.llm,
      logger: silentLogger,
      configPath: ['models'],
      credentials,
    })

    await chain.stream(
      {
        model: model.model,
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 1,
        reasoningMode: 'default',
        signal: AbortSignal.timeout(ONLINE_TIMEOUT_MS),
      },
      () => undefined
    )

    return {
      name: model.provider,
      status: 'ok',
      detail: t(locale, 'cli.doctorProbedModel', { model: model.model }),
    }
  } catch (err: unknown) {
    // The probe caps output at one token, so a reachable provider commonly answers with nothing or
    // stops at the cap. Both prove the endpoint works, which is all this check asks.
    if (err instanceof LLMError && PROBE_REACHED_CODES.has(err.code)) {
      return {
        name: model.provider,
        status: 'ok',
        detail: t(locale, 'cli.doctorProbedModel', { model: model.model }),
      }
    }

    return { name: model.provider, status: 'fail', detail: modelProbeFailure(err, model, locale) }
  }
}

async function probeBotToken(options: BotProbeOptions): Promise<DoctorProbe | null> {
  const { channel, config, env, locale } = options
  const name = checkLabel(locale, channel)
  const parsed = botConfigSchema.safeParse(config.channels[channel])

  if (!parsed.success || parsed.data.enabled === false) {
    return null
  }

  const token = resolveSecret(parsed.data, env)

  if (token === '') {
    return { name, status: 'fail', detail: t(locale, 'cli.doctorTokenNotResolved') }
  }

  try {
    const res = await httpRequest({
      hosts: [BOT_API_HOSTS[channel]],
      path: `/bot${token}/getMe`,
      signal: AbortSignal.timeout(ONLINE_TIMEOUT_MS),
    })
    const body = getMeSchema.safeParse(JSON.parse(res.text))

    return body.success && body.data.ok
      ? { name, status: 'ok', detail: t(locale, 'cli.doctorGetMeOk') }
      : { name, status: 'fail', detail: t(locale, 'cli.doctorGetMeFailed') }
  } catch (err: unknown) {
    return { name, status: 'fail', detail: probeFailure(err, locale) }
  }
}

async function reachProbe(options: {
  readonly host: string
  readonly path: string
  readonly query: Record<string, string>
  readonly locale: Locale
}): Promise<DoctorProbe> {
  const name = checkLabel(options.locale, 'web-search')

  try {
    await httpRequest({
      hosts: [options.host],
      path: options.path,
      query: options.query,
      signal: AbortSignal.timeout(ONLINE_TIMEOUT_MS),
    })

    return { name, status: 'ok', detail: t(options.locale, 'cli.doctorEndpointReachable') }
  } catch (err: unknown) {
    return { name, status: 'fail', detail: probeFailure(err, options.locale) }
  }
}

function offlineWebSearchRow(provider: string, locale: Locale): DoctorProbe {
  return {
    name: checkLabel(locale, 'web-search'),
    status: 'ok',
    detail: t(locale, 'cli.doctorWebSearchOffline', { provider }),
  }
}

/** A server on this machine that does not answer is almost always one not started yet; say that
 *  rather than a bare error code. */
function modelProbeFailure(err: unknown, model: ResolvedModel, locale: Locale): string {
  const provider = findProviderById(model.provider)
  const url = model.baseUrl ?? provider?.baseUrl ?? ''
  const unreachable = err instanceof LLMError && UNREACHABLE_CODES.has(err.code)

  if (unreachable && NetworkPolicy.isLoopbackUrl(url)) {
    const name = provider?.displayName ?? model.provider

    return t(locale, 'cli.doctorLocalServerDown', { url, provider: name })
  }

  return probeFailure(err, locale)
}

function probeFailure(err: unknown, locale: Locale): string {
  if (err instanceof LLMError) {
    return t(locale, 'cli.doctorProbeFailedCode', { code: err.code })
  }

  return t(locale, 'cli.doctorProbeFailed')
}
