import type { ExaSearchType, RawWebSearch, WEB_SEARCH_PROVIDERS } from '@/core/config/schema'
import { MissingEnvError, OperatorConfigError } from '@/core/config/operator-errors'

const DEFAULT_SEARCH_CACHE_TTL_SECONDS = 300
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
const PER_SEARCH_COST_PROVIDERS: readonly SearchProvider[] = ['brave', 'serper', 'tavily']
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
  readonly cacheTtlSeconds: number
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
  const apiKey = envApiKey(raw?.api_key_env, 'api_key_env')
  const baseUrl = raw?.base_url
  const costPerSearchUsd = raw?.cost_per_search_usd
  const fallbackApiKey = envApiKey(raw?.fallback_api_key_env, 'fallback_api_key_env')
  const fallbackBaseUrl = raw?.fallback_base_url

  assertProviderRequirements({ provider, apiKey, baseUrl, label: 'provider' })
  assertCostPerSearch(provider, costPerSearchUsd, 'cost_per_search_usd')

  const fallback = toFallbackConfig({
    provider: raw?.fallback_provider,
    apiKey: fallbackApiKey,
    baseUrl: fallbackBaseUrl,
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
    ...(costPerSearchUsd === undefined ? {} : { costPerSearchUsd }),
    ...(fallback === undefined ? {} : { fallback }),
    ...SEARCH_BOUNDS,
    cacheTtlSeconds: raw?.cache_ttl_seconds ?? DEFAULT_SEARCH_CACHE_TTL_SECONDS,
    exaSearchType: raw?.exa_search_type ?? 'auto',
    ...(raw?.safe_search === undefined ? {} : { safeSearch: raw.safe_search }),
  }
}

interface ProviderRequirementInput {
  readonly provider: SearchProvider
  readonly apiKey: string | undefined
  readonly baseUrl: string | undefined
  readonly label: string
}

function assertProviderRequirements(input: ProviderRequirementInput): void {
  const { provider, apiKey, baseUrl, label } = input
  if (provider === 'searxng') {
    assertSearxngBaseUrl(label, baseUrl)
    return
  }

  assertHostedProviderBaseUrl(label, baseUrl)

  if (!KEY_OPTIONAL_PROVIDERS.includes(provider) && apiKey === undefined) {
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
  readonly apiKey: string | undefined
  readonly baseUrl: string | undefined
  readonly costPerSearchUsd: number | undefined
}

function toFallbackConfig(input: FallbackConfigInput): SearchProviderConfig | undefined {
  const { provider, apiKey, baseUrl, costPerSearchUsd } = input

  if (provider === undefined) {
    if (apiKey !== undefined || baseUrl !== undefined || costPerSearchUsd !== undefined) {
      throw new OperatorConfigError(
        'web_search fallback settings require fallback_provider',
        { key: 'errors.configSearchFallbackMissing' },
        { path: ['web_search', 'fallback_provider'] }
      )
    }

    return undefined
  }

  assertProviderRequirements({ provider, apiKey, baseUrl, label: 'fallback_provider' })
  assertCostPerSearch(provider, costPerSearchUsd, 'fallback_cost_per_search_usd')

  return {
    provider,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(costPerSearchUsd === undefined ? {} : { costPerSearchUsd }),
  }
}

/** A named variable that is empty fails here, naming it, rather than reading as no key at all. */
function envApiKey(name: string | undefined, field: string): string | undefined {
  if (name === undefined) {
    return undefined
  }

  const value = process.env[name]?.trim()

  if (value === undefined || value === '') {
    throw new MissingEnvError(name, '[web_search]', ['web_search', field])
  }

  return value
}
