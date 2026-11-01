import type { SearchBackend } from '@/tools/web/search/types'
import { runApiKeyProvider } from '@/tools/web/search/backends/api-key-provider'
import { toFreeSearchResponse, toSearchResults } from '@/tools/web/search/result-parser'

export const TAVILY_ENDPOINT = 'https://api.tavily.com/search'
const TAVILY_HEADER = 'Authorization'
const TAVILY_BEARER_PREFIX = 'Bearer '

const RECENCY_TO_TAVILY = {
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
} as const

const TAVILY_FIELDS = { title: 'title', url: 'url', snippet: 'content' } as const

export const tavilySearch: SearchBackend = (request) =>
  runApiKeyProvider({
    request,
    endpoint: TAVILY_ENDPOINT,
    header: TAVILY_HEADER,
    toHeaderValue: (apiKey) => `${TAVILY_BEARER_PREFIX}${apiKey}`,
    body: (req) =>
      JSON.stringify({
        query: req.query,
        max_results: req.maxResults,
        ...(req.includeDomains === undefined ? {} : { include_domains: req.includeDomains }),
        ...(req.excludeDomains === undefined ? {} : { exclude_domains: req.excludeDomains }),
        ...(req.recency === undefined ? {} : { time_range: RECENCY_TO_TAVILY[req.recency] }),
      }),
    parse: (value, max) => {
      if (typeof value !== 'object' || value === null || !('results' in value)) {
        return toFreeSearchResponse([], request)
      }
      return toFreeSearchResponse(toSearchResults(value.results, TAVILY_FIELDS, max), request)
    },
  })
