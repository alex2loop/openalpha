import type { SearchBackend, SearchRequest, SearchResult } from '@/tools/web/search/types'
import { ToolError } from '@/core/errors'
import { parseRetryAfterMs, readCappedText } from '@/core/http-client'
import { NetworkPolicy } from '@/core/ssrf/network-policy'
import { isPlainRecord } from '@/core/utils/collections'
import { parseJsonBody } from '@/tools/web/search/body-cap'
import { filterSearchResults, toDomainQuery, toHttpUrl } from '@/tools/web/search/domains'
import {
  isSearchRetryableStatus,
  SEARCH_RETRY_AFTER_MAX_MS,
  SearchProviderError,
  SearchRetryableError,
} from '@/tools/web/search/errors'
import { toFreeSearchResponse, toSearchResults } from '@/tools/web/search/result-parser'

const RECENCY_TO_SEARXNG = { day: 'day', month: 'month', year: 'year' } as const
const SEARXNG_SEARCH_PATH = 'search'
const SEARXNG_MAX_BYTES = 1_048_576
const SEARXNG_DIAGNOSTIC_MAX_ENGINES = 20
const SEARXNG_DIAGNOSTIC_MAX_NAME_LENGTH = 64
const SEARXNG_FIELDS = { title: 'title', url: 'url', snippet: 'content' } as const

interface SearxngPayload {
  readonly results: readonly unknown[]
  readonly unresponsiveEngines: readonly string[]
}

interface SearxngDiagnostics {
  readonly engines: readonly string[]
  readonly categories: readonly string[]
}

interface DiagnosticNames {
  readonly seen: Set<string>
  readonly values: string[]
}

export const searxngSearch: SearchBackend = async (request) => {
  if (!request.baseUrl) {
    throw new SearchProviderError('invalid_request', 'SearXNG is not configured')
  }

  const response = await fetchSearxng(request)

  if (!response.ok) {
    await handleSearxngHttpError(response)
  }

  const text = await readCappedText(response, SEARXNG_MAX_BYTES)
  const value: unknown = parseJsonBody(text)

  const parsed = toFreeSearchResponse(handleSearxngPayload(value, request), request)

  return request.recency === 'week' ? { ...parsed, freshness: 'unverified' } : parsed
}

async function fetchSearxng(request: SearchRequest): Promise<Response> {
  if (!request.baseUrl) {
    throw new ToolError('unexpected', 'SearXNG baseUrl is required')
  }

  const url = buildSearxngUrl(request.baseUrl, request)
  const endpoint = url.toString()
  const fetchInit: RequestInit = { signal: request.signal }

  if (NetworkPolicy.isLoopbackUrl(endpoint)) {
    return NetworkPolicy.guardedLoopbackFetch(endpoint, fetchInit)
  }

  const hostname = new URL(endpoint).hostname
  const guarded = await NetworkPolicy.guardedFetch(endpoint, fetchInit, {
    allowlist: [hostname],
    ...(request.dnsLookup === undefined ? {} : { dnsLookup: request.dnsLookup }),
  })

  return guarded.response
}

function buildSearxngUrl(baseUrl: string, request: SearchRequest): URL {
  const url = toSearxngSearchUrl(baseUrl)
  url.searchParams.set('q', toDomainQuery(request))
  url.searchParams.set('format', 'json')
  url.searchParams.set('language', request.language)

  if (request.safeSearch !== undefined) {
    url.searchParams.set('safesearch', String(request.safeSearch))
  }

  const timeRange = request.recency === 'week' ? undefined : request.recency

  if (timeRange !== undefined) {
    url.searchParams.set('time_range', RECENCY_TO_SEARXNG[timeRange])
  }

  return url
}

async function handleSearxngHttpError(response: Response): Promise<readonly SearchResult[]> {
  await response.body?.cancel().catch(() => undefined)

  if (isSearchRetryableStatus(response.status)) {
    const nowMs = Date.now()

    throw new SearchRetryableError(`SearXNG returned HTTP ${response.status}`, {
      retryAfterMs:
        parseRetryAfterMs(response.headers.get('retry-after'), nowMs, SEARCH_RETRY_AFTER_MAX_MS) ??
        0,
      failureCode: response.status === 429 ? 'rate_limited' : 'transport',
    })
  }

  throw new ToolError('unexpected', `SearXNG returned HTTP ${response.status}`)
}

function handleSearxngPayload(value: unknown, request: SearchRequest): readonly SearchResult[] {
  const payload = parseSearxngPayload(value)
  const results = toExternalResults(payload.results, request)
  const diagnostics = collectSearxngDiagnostics(payload.results)

  request.logger.debug('web_search.searxng.results', {
    count: results.length,
    engines: diagnostics.engines,
    categories: diagnostics.categories,
  })

  if (payload.unresponsiveEngines.length > 0) {
    request.logger.warn('web_search.searxng.unresponsive_engines', {
      engines: payload.unresponsiveEngines,
    })

    if (results.length === 0) {
      throw new SearchRetryableError(
        'SearXNG returned no usable results; some engines reported unresponsive',
        { retryAfterMs: 0 }
      )
    }
  }

  return results.map((result) => ({ ...result, engines: diagnostics.engines }))
}

function toSearxngSearchUrl(baseUrl: string): URL {
  const url = new URL(baseUrl)

  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`
  }

  return new URL(SEARXNG_SEARCH_PATH, url)
}

function parseSearxngPayload(value: unknown): SearxngPayload {
  if (!(isPlainRecord(value) && Array.isArray(value.results))) {
    throw new ToolError('unexpected', 'SearXNG returned an invalid response')
  }

  const unresponsiveEngines = parseUnresponsiveEngines(value.unresponsive_engines)

  return { results: value.results, unresponsiveEngines }
}

function parseUnresponsiveEngines(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const names = createDiagnosticNames()

  for (const entry of value) {
    if (names.values.length >= SEARXNG_DIAGNOSTIC_MAX_ENGINES) {
      break
    }

    if (Array.isArray(entry)) {
      addDiagnosticName(names, entry[0])
    }
  }

  return names.values
}

function toExternalResults(
  results: readonly unknown[],
  request: SearchRequest
): readonly SearchResult[] {
  const origin = request.baseUrl !== undefined ? new URL(request.baseUrl).origin : undefined
  const normalized = toSearchResults(results, SEARXNG_FIELDS, results.length)
  const external = normalized.filter((result) => isExternalResult(result, origin))

  return filterSearchResults(external, request, request.maxResults)
}

function isExternalResult(result: SearchResult, origin: string | undefined): boolean {
  const parsed = toHttpUrl(result.url)

  if (parsed === undefined) {
    return false
  }

  if (origin !== undefined && parsed.origin === origin) {
    return false
  }

  return true
}

function collectSearxngDiagnostics(results: readonly unknown[]): SearxngDiagnostics {
  const engines = createDiagnosticNames()
  const categories = createDiagnosticNames()

  for (const result of results) {
    if (!isPlainRecord(result)) {
      continue
    }

    addDiagnosticName(engines, result.engine)
    addDiagnosticName(categories, result.category)

    if (Array.isArray(result.engines)) {
      addDiagnosticNames(engines, result.engines)
    }

    if (
      engines.values.length >= SEARXNG_DIAGNOSTIC_MAX_ENGINES &&
      categories.values.length >= SEARXNG_DIAGNOSTIC_MAX_ENGINES
    ) {
      break
    }
  }

  return { engines: engines.values, categories: categories.values }
}

function createDiagnosticNames(): DiagnosticNames {
  return { seen: new Set<string>(), values: [] }
}

function addDiagnosticNames(names: DiagnosticNames, values: readonly unknown[]): void {
  for (const value of values) {
    if (names.values.length >= SEARXNG_DIAGNOSTIC_MAX_ENGINES) {
      break
    }

    addDiagnosticName(names, value)
  }
}

function addDiagnosticName(names: DiagnosticNames, value: unknown): void {
  if (typeof value !== 'string' || names.values.length >= SEARXNG_DIAGNOSTIC_MAX_ENGINES) {
    return
  }

  const name = value.trim().slice(0, SEARXNG_DIAGNOSTIC_MAX_NAME_LENGTH)

  if (name === '' || names.seen.has(name)) {
    return
  }

  names.seen.add(name)
  names.values.push(name)
}
