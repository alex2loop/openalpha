import type { SearchBackend, SearchBackendResponse } from '@/tools/web/search/types'
import { MS_PER_DAY } from '@/core/utils/time'
import { runApiKeyProvider } from '@/tools/web/search/backends/api-key-provider'
import {
  EXA_API_ORIGIN,
  EXA_AUTHORIZATION_HEADER,
  EXA_BEARER_PREFIX,
  EXA_SEARCH_PATH,
  exaSearchBody,
  parseExaSearchResponse,
} from '@/tools/web/search/backends/exa-protocol'

const RECENCY_DAYS = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
} as const

export const exaSearch: SearchBackend = (request) =>
  runApiKeyProvider({
    request,
    endpoint: `${EXA_API_ORIGIN}${EXA_SEARCH_PATH}`,
    header: EXA_AUTHORIZATION_HEADER,
    toHeaderValue: (apiKey) => `${EXA_BEARER_PREFIX}${apiKey}`,
    body: buildExaSearchBody,
    parse: (value, maxResults) =>
      withFreshness(
        parseExaSearchResponse(value, request.exaSearchType ?? 'auto', maxResults),
        request
      ),
  })

function buildExaSearchBody(request: Parameters<SearchBackend>[0]): string {
  const now = Date.now()
  const recencyStart =
    request.recency === undefined
      ? undefined
      : new Date(now - RECENCY_DAYS[request.recency] * MS_PER_DAY).toISOString()
  const canPushResearchFreshness = request.freshness?.field === 'publishedOn'
  const startPublishedDate =
    recencyStart ??
    (canPushResearchFreshness && request.freshness?.fromOn !== undefined
      ? `${request.freshness.fromOn}T00:00:00.000Z`
      : undefined)
  const endPublishedDate =
    canPushResearchFreshness && request.freshness?.toOn !== undefined
      ? `${request.freshness.toOn}T23:59:59.999Z`
      : undefined

  return exaSearchBody({
    query: request.query,
    maxResults: request.maxResults,
    ...(request.exaSearchType === undefined ? {} : { exaSearchType: request.exaSearchType }),
    ...(request.includeDomains === undefined ? {} : { includeDomains: request.includeDomains }),
    ...(request.excludeDomains === undefined ? {} : { excludeDomains: request.excludeDomains }),
    ...(startPublishedDate === undefined ? {} : { startPublishedDate }),
    ...(endPublishedDate === undefined ? {} : { endPublishedDate }),
  })
}

function withFreshness(
  response: SearchBackendResponse,
  request: Parameters<SearchBackend>[0]
): SearchBackendResponse {
  if (request.recency === undefined && request.freshness === undefined) {
    return response
  }

  const pushedDown =
    request.recency !== undefined ||
    request.freshness?.field === 'publishedOn' ||
    request.freshness?.field === 'either'

  return { ...response, freshness: pushedDown ? 'pushed_down' : 'unverified' }
}
