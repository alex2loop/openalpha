import type {
  ProviderContentsRunInput,
  ProviderSearchRunInput,
  SearchRequest,
  SearchResult,
} from '@/tools/web/search/types'
import { SearchProviderError } from '@/tools/web/search/errors'

export function toDomainQuery(request: SearchRequest): string {
  const includePart = (request.includeDomains ?? []).map((domain) => `site:${domain}`).join(' OR ')
  const excludePart = (request.excludeDomains ?? []).map((domain) => `-site:${domain}`).join(' ')
  const includeClause = includePart === '' ? '' : `(${includePart})`

  return [request.query, includeClause, excludePart].filter(Boolean).join(' ')
}

export function toHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value)

    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

export function filterSearchResults(
  results: readonly SearchResult[],
  request: SearchRequest,
  maxResults: number
): readonly SearchResult[] {
  return results.filter((result) => isAllowedUrl(result.url, request)).slice(0, maxResults)
}

export function searchCacheKey(
  input: ProviderSearchRunInput,
  exaSearchType: string
): string | undefined {
  if (input.cacheScope === undefined) {
    return undefined
  }

  return JSON.stringify([
    'search',
    input.cacheScope,
    input.role,
    input.configured.provider,
    normalizeQuery(input.request.query),
    input.requestedMaxResults,
    input.request.language,
    input.request.recency,
    input.request.freshness,
    normalizeDomains(input.request.includeDomains),
    normalizeDomains(input.request.excludeDomains),
    input.request.safeSearch,
    exaSearchType,
  ])
}

export function contentsCacheKey(
  input: ProviderContentsRunInput,
  exaSearchType: string
): string | undefined {
  return input.cacheScope === undefined
    ? undefined
    : JSON.stringify([
        'contents',
        input.cacheScope,
        input.role,
        input.configured.provider,
        [...input.urls].sort(),
        normalizeQuery(input.query),
        exaSearchType,
      ])
}

export function normalizeProviderUrls(values: readonly string[]): readonly string[] {
  const urls = new Set<string>()

  for (const value of values) {
    const url = new URL(value)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new SearchProviderError('invalid_request', 'content URL is unsupported')
    }

    url.hash = ''
    urls.add(url.toString())
  }

  return [...urls]
}

function isAllowedUrl(urlValue: string, request: SearchRequest): boolean {
  const url = toHttpUrl(urlValue)

  if (url === undefined) {
    return false
  }

  const hostname = url.hostname.toLowerCase()

  const isIncluded =
    request.includeDomains === undefined ||
    request.includeDomains.length === 0 ||
    request.includeDomains.some((domain) => isDomainMatch(hostname, domain))
  const isExcluded = request.excludeDomains?.some((domain) => isDomainMatch(hostname, domain))

  return isIncluded && isExcluded !== true
}

function isDomainMatch(hostname: string, domain: string): boolean {
  const normalized = domain.toLowerCase()

  return hostname === normalized || hostname.endsWith(`.${normalized}`)
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function normalizeDomains(domains: readonly string[] | undefined): readonly string[] {
  return [...new Set((domains ?? []).map((domain) => domain.toLocaleLowerCase()))].sort()
}
