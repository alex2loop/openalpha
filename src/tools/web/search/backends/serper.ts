import type { SearchBackend } from '@/tools/web/search/types'
import { runApiKeyProvider } from '@/tools/web/search/backends/api-key-provider'
import { toDomainQuery } from '@/tools/web/search/domains'
import { toFreeSearchResponse, toSearchResults } from '@/tools/web/search/result-parser'

export const SERPER_ENDPOINT = 'https://google.serper.dev/search'
const SERPER_HEADER = 'X-API-KEY'

const RECENCY_TO_SERPER = {
  day: 'qdr:d',
  week: 'qdr:w',
  month: 'qdr:m',
  year: 'qdr:y',
} as const

const SERPER_FIELDS = { title: 'title', url: 'link', snippet: 'snippet' } as const

export const serperSearch: SearchBackend = (request) =>
  runApiKeyProvider({
    request,
    endpoint: SERPER_ENDPOINT,
    header: SERPER_HEADER,
    body: (req) =>
      JSON.stringify({
        q: toDomainQuery(req),
        num: req.maxResults,
        ...(req.recency === undefined ? {} : { tbs: RECENCY_TO_SERPER[req.recency] }),
      }),
    parse: (value, max) => {
      if (typeof value !== 'object' || value === null || !('organic' in value)) {
        return toFreeSearchResponse([], request)
      }
      return toFreeSearchResponse(toSearchResults(value.organic, SERPER_FIELDS, max), request)
    },
  })
