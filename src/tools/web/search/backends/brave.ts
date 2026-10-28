import type { SearchBackend } from '@/tools/web/search/types'
import { runApiKeyProvider } from '@/tools/web/search/backends/api-key-provider'
import { toDomainQuery } from '@/tools/web/search/domains'
import { toFreeSearchResponse, toSearchResults } from '@/tools/web/search/result-parser'

export const BRAVE_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
const BRAVE_HEADER = 'X-Subscription-Token'

const RECENCY_TO_BRAVE = {
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
} as const

const BRAVE_FIELDS = { title: 'title', url: 'url', snippet: 'description' } as const

export const braveSearch: SearchBackend = (request) =>
  runApiKeyProvider({
    request,
    endpoint: BRAVE_ENDPOINT,
    header: BRAVE_HEADER,
    body: (req) =>
      JSON.stringify({
        q: toDomainQuery(req),
        count: req.maxResults,
        ...(req.recency === undefined ? {} : { freshness: RECENCY_TO_BRAVE[req.recency] }),
      }),
    parse: (value, max) => {
      if (typeof value !== 'object' || value === null) {
        return toFreeSearchResponse([], request)
      }
      const results =
        'web' in value &&
        typeof value.web === 'object' &&
        value.web !== null &&
        'results' in value.web
          ? value.web.results
          : []
      return toFreeSearchResponse(toSearchResults(results, BRAVE_FIELDS, max), request)
    },
  })
