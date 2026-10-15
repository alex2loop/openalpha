import type { SearchBackend, SearchBackendResponse, SearchRequest } from '@/tools/web/search/types'
import { isPlainRecord } from '@/core/utils/collections'
import { runHostedProvider } from '@/tools/web/search/backends/api-key-provider'
import { toDomainQuery } from '@/tools/web/search/domains'
import { SearchProviderError } from '@/tools/web/search/errors'
import { toSearchResults } from '@/tools/web/search/result-parser'
import { ZERO_PROVIDER_COST_USD } from '@/tools/web/search/types'

const ANYSEARCH_ENDPOINT = 'https://api.anysearch.com/v1/search'
const ANYSEARCH_AUTHORIZATION_HEADER = 'Authorization'
const ANYSEARCH_BEARER_PREFIX = 'Bearer '
const ANYSEARCH_RESPONSE_FORMAT = 'json'
const ANYSEARCH_FIELDS = { title: 'title', url: 'url', snippet: 'snippet' } as const

interface AnySearchParseInput {
  readonly maxResults: number
  readonly recency?: SearchRequest['recency']
  readonly freshness?: SearchRequest['freshness']
}

interface ParsedAnySearchEnvelope {
  readonly results: readonly unknown[]
  readonly requestId: string
}

export const anysearchSearch: SearchBackend = (request) =>
  runHostedProvider({
    authentication: 'optional',
    ...(request.apiKey === undefined ? {} : { apiKey: request.apiKey }),
    signal: request.signal,
    endpoint: ANYSEARCH_ENDPOINT,
    header: ANYSEARCH_AUTHORIZATION_HEADER,
    toHeaderValue: (apiKey) => ANYSEARCH_BEARER_PREFIX + apiKey,
    body: JSON.stringify({
      query: toDomainQuery(request),
      max_results: request.maxResults,
      language: request.language,
      format: ANYSEARCH_RESPONSE_FORMAT,
    }),
    parse: (value) => parseAnySearchResponse(value, request),
  })

function parseAnySearchResponse(value: unknown, input: AnySearchParseInput): SearchBackendResponse {
  const envelope = parseAnySearchEnvelope(value)
  const results = toSearchResults(envelope.results, ANYSEARCH_FIELDS, input.maxResults)

  if (envelope.results.length > 0 && results.length === 0) {
    throw invalidResponse()
  }
  return {
    results,
    costUsd: ZERO_PROVIDER_COST_USD,
    freshness:
      input.recency === undefined && input.freshness === undefined ? 'not_requested' : 'unverified',
    requestId: envelope.requestId,
  }
}

function parseAnySearchEnvelope(value: unknown): ParsedAnySearchEnvelope {
  if (!(isPlainRecord(value) && value.code === 0 && isNonEmptyText(value.request_id))) {
    throw invalidResponse()
  }
  if (!(isPlainRecord(value.data) && Array.isArray(value.data.results))) {
    throw invalidResponse()
  }
  if (!hasValidMetadata(value.data.metadata, value.data.results.length)) {
    throw invalidResponse()
  }
  return { results: value.data.results, requestId: value.request_id }
}

function hasValidMetadata(value: unknown, resultCount: number): boolean {
  if (!isPlainRecord(value)) {
    return false
  }
  return (
    Number.isSafeInteger(value.total_results) &&
    value.total_results === resultCount &&
    Number.isSafeInteger(value.search_time_ms) &&
    typeof value.search_time_ms === 'number' &&
    value.search_time_ms >= 0
  )
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function invalidResponse(): SearchProviderError {
  return new SearchProviderError('invalid_response', 'search provider returned invalid response')
}
