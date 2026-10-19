import type { ExaSearchType, RawWebSearch, WEB_SEARCH_PROVIDERS } from '@/core/config/schema'
import { MissingEnvError, OperatorConfigError } from '@/core/config/operator-errors'
import { MS_PER_MINUTE } from '@/core/utils/time'

const DEFAULT_SEARCH_CACHE_TTL_MS = 5 * MS_PER_MINUTE
const SEARCH_KEY_OWNER = '[web_search]'
const SEARCH_BOUNDS = Object.freeze({
  cacheMaxEntries: 100,
  timeoutMs: 15_000,
  retryAttempts: 3,
  retryInitialMs: 800,
  breakerThreshold: 3,
  breakerCooldownMs: 60_000,
  snippetMaxChars: 400,
})

type SearchProvider = (typeof WEB_SEARCH_PROVIDERS)[number]
export type WebSearchProvider = SearchProvider

// Bill per query without reporting it; exa reports its own cost, the rest are free.
const PER_SEARCH_COST_PROVIDERS: readonly SearchProvider[] = [
  'brave',
  'deepseek',
  'serper',
  'tavily',
]
const KEY_OPTIONAL_PROVIDERS: readonly SearchProvider[] = ['duckduckgo', 'anysearch']

interface SearchProviderConfig {
  readonly provider: SearchProvider
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly costPerSearchUsd?: number
}

export interface ResolvedSearchProvider extends SearchProviderConfig {}

export interface ResolvedWebSearch {
  readonly provider: WebSearchProvider
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly costPerSearchUsd?: number
  readonly fallback?: SearchProviderConfig
  /** The variables `api_key_env` and `fallback_api_key_env` name, set or not. */
  readonly apiKeyEnv?: string
  readonly fallbackApiKeyEnv?: string
  /** `api_key_env` names this variable and the environment leaves it empty: search is off. */
  readonly missingEnv?: string
  /** The same for `fallback_api_key_env`: the fallback is dropped and the primary keeps working. */
  readonly fallbackMissingEnv?: string
  readonly cacheTtlMs: number
  readonly cacheMaxEntries: number
  readonly timeoutMs: number
  readonly retryAttempts: number
  readonly retryInitialMs: number
  readonly breakerThreshold: number
  readonly breakerCooldownMs: number
  readonly snippetMaxChars: number
  readonly exaSearchType: ExaSearchType
  readonly safeSearch?: 0 | 1 | 2
}

export function resolveWebSearch(raw: RawWebSearch | undefined): ResolvedWebSearch {
  const provider = raw?.provider ?? 'duckduckgo'
  const { apiKey, missingEnv } = readEnvKey(raw?.api_key_env)
  const baseUrl = raw?.base_url
  const costPerSearchUsd = raw?.cost_per_search_usd
  const fallbackKey = readEnvKey(raw?.fallback_api_key_env)

  assertProviderRequirements({
    provider,
    apiKeyEnv: raw?.api_key_env,
    baseUrl,
    label: 'provider',
  })
  assertCostPerSearch(provider, costPerSearchUsd, 'cost_per_search_usd')

  const fallback = toFallbackConfig({
    provider: raw?.fallback_provider,
    apiKeyEnv: raw?.fallback_api_key_env,
    apiKey: fallbackKey.apiKey,
    baseUrl: raw?.fallback_base_url,
    costPerSearchUsd: raw?.fallback_cost_per_search_usd,
  })

  if (fallback?.provider === provider) {
    throw new OperatorConfigError(
      'web_search fallback_provider must differ from provider',
      { key: 'errors.configSearchFallbackSame' },
      { path: ['web_search', 'fallback_provider'] }
    )
  }

  return {
    provider,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(raw?.api_key_env === undefined ? {} : { apiKeyEnv: raw.api_key_env }),
    ...(raw?.fallback_api_key_env === undefined
      ? {}
      : { fallbackApiKeyEnv: raw.fallback_api_key_env }),
    ...(costPerSearchUsd === undefined ? {} : { costPerSearchUsd }),
    ...(missingEnv === undefined ? {} : { missingEnv: missingEnv }),
    ...(fallback === undefined || fallbackKey.missingEnv !== undefined ? {} : { fallback }),
    ...(fallbackKey.missingEnv === undefined ? {} : { fallbackMissingEnv: fallbackKey.missingEnv }),
    ...SEARCH_BOUNDS,
    cacheTtlMs: raw?.cache_ttl_ms ?? DEFAULT_SEARCH_CACHE_TTL_MS,
    exaSearchType: raw?.exa_search_type ?? 'auto',
    ...(raw?.safe_search === undefined ? {} : { safeSearch: raw.safe_search }),
  }
}

/** The refusal for search whose `api_key_env` names a variable the environment leaves empty. */
export function toMissingSearchKeyError(search: ResolvedWebSearch): MissingEnvError | undefined {
  return search.missingEnv === undefined
    ? undefined
    : new MissingEnvError(search.missingEnv, SEARCH_KEY_OWNER, {
        path: ['web_search', 'api_key_env'],
        effect: 'search',
      })
}

interface ProviderRequirementInput {
  readonly provider: SearchProvider
  readonly apiKeyEnv: string | undefined
  readonly baseUrl: string | undefined
  readonly label: string
}

function assertProviderRequirements(input: ProviderRequirementInput): void {
  const { provider, apiKeyEnv, baseUrl, label } = input
  if (provider === 'searxng') {
    assertSearxngBaseUrl(label, baseUrl)
    return
  }

  assertHostedProviderBaseUrl(label, baseUrl)

  if (!KEY_OPTIONAL_PROVIDERS.includes(provider) && apiKeyEnv === undefined) {
    throw new OperatorConfigError(
      `web_search ${label} "${provider}" requires api_key_env`,
      { key: 'errors.configSearchKeyMissing', params: { provider } },
      { path: ['web_search'] }
    )
  }
}

function assertCostPerSearch(
  provider: SearchProvider,
  costPerSearchUsd: number | undefined,
  key: string
): void {
  if (costPerSearchUsd === undefined || PER_SEARCH_COST_PROVIDERS.includes(provider)) {
    return
  }

  const providers = PER_SEARCH_COST_PROVIDERS.join(', ')

  throw new OperatorConfigError(
    `web_search ${key} is supported only for providers ${providers}`,
    { key: 'errors.configSearchCostUnsupported', params: { field: key, providers } },
    { path: ['web_search', key] }
  )
}

function assertSearxngBaseUrl(label: string, baseUrl: string | undefined): void {
  if (baseUrl === undefined || baseUrl === '') {
    const field = label === 'provider' ? 'base_url' : 'fallback_base_url'

    throw new OperatorConfigError(
      `web_search ${label} "searxng" requires a non-empty base_url`,
      { key: 'errors.configSearxngUrlMissing', params: { field } },
      { path: ['web_search', field] }
    )
  }
}

function assertHostedProviderBaseUrl(label: string, baseUrl: string | undefined): void {
  if (baseUrl !== undefined) {
    const field = label === 'provider' ? 'base_url' : 'fallback_base_url'

    throw new OperatorConfigError(
      `web_search ${label} base_url is supported only for provider "searxng"`,
      { key: 'errors.configSearchUrlUnsupported', params: { field } },
      { path: ['web_search', field] }
    )
  }
}

interface FallbackConfigInput {
  readonly provider: SearchProvider | undefined
  readonly apiKeyEnv: string | undefined
  readonly apiKey: string | undefined
  readonly baseUrl: string | undefined
  readonly costPerSearchUsd: number | undefined
}

function toFallbackConfig(input: FallbackConfigInput): SearchProviderConfig | undefined {
  const { provider, apiKeyEnv, apiKey, baseUrl, costPerSearchUsd } = input

  if (provider === undefined) {
    if (apiKeyEnv !== undefined || baseUrl !== undefined || costPerSearchUsd !== undefined) {
      throw new OperatorConfigError(
        'web_search fallback settings require fallback_provider',
        { key: 'errors.configSearchFallbackMissing' },
        { path: ['web_search', 'fallback_provider'] }
      )
    }

    return undefined
  }

  assertProviderRequirements({ provider, apiKeyEnv, baseUrl, label: 'fallback_provider' })
  assertCostPerSearch(provider, costPerSearchUsd, 'fallback_cost_per_search_usd')

  return {
    provider,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(costPerSearchUsd === undefined ? {} : { costPerSearchUsd }),
  }
}

interface EnvKeyRead {
  readonly apiKey?: string
  readonly missingEnv?: string
}

/** A named variable that is empty reads as `missingEnv`, not as no key at all: the operator asked
 *  for a key and the environment did not supply it. */
function readEnvKey(name: string | undefined): EnvKeyRead {
  if (name === undefined) {
    return {}
  }

  const value = process.env[name]?.trim()

  return value === undefined || value === '' ? { missingEnv: name } : { apiKey: value }
}
