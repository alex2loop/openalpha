import type { SearchBackend, SearchRequest } from '@/tools/web/search/types'
import { isPlainRecord } from '@/core/utils/collections'
import { dayInZone, MS_PER_DAY } from '@/core/utils/time'
import { runApiKeyProvider } from '@/tools/web/search/backends/api-key-provider'
import {
  isPublishedFreshness,
  toFreeSearchResponse,
  toSearchResults,
  withPushedFreshness,
} from '@/tools/web/search/result-parser'
import { RECENCY_DAYS } from '@/tools/web/search/types'

const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/v1/tools/search'
const DEEPSEEK_AUTHORIZATION_HEADER = 'Authorization'
const DEEPSEEK_BEARER_PREFIX = 'Bearer '
const DEEPSEEK_QUERY_MAX_CHARS = 128
// Results are dated at midnight Beijing time, and after:/before: read their day in the same zone.
const DEEPSEEK_TIME_ZONE = 'Asia/Shanghai'
const DEEPSEEK_FIELDS = {
  title: 'title',
  url: 'url',
  snippet: 'snippet',
  publishedOn: 'publishedOn',
} as const
const WHITESPACE_RE = /\s+/

export const deepseekSearch: SearchBackend = (request) =>
  runApiKeyProvider({
    request,
    endpoint: DEEPSEEK_ENDPOINT,
    header: DEEPSEEK_AUTHORIZATION_HEADER,
    toHeaderValue: (apiKey) => `${DEEPSEEK_BEARER_PREFIX}${apiKey}`,
    body: (req) =>
      JSON.stringify({
        query: buildDeepSeekQuery(req, Date.now()),
        count: req.maxResults,
      }),
    parse: (value, max) =>
      withPushedFreshness(
        toFreeSearchResponse(
          toSearchResults(toDeepSeekItems(value), DEEPSEEK_FIELDS, max),
          request
        ),
        request
      ),
  })

function buildDeepSeekQuery(request: SearchRequest, nowMs: number): string {
  const dateTerms = deepSeekDateTerms(request, nowMs)
  const full = [request.query, ...deepSeekDomainTerms(request), ...dateTerms].join(' ')

  if (codePointLength(full) <= DEEPSEEK_QUERY_MAX_CHARS) {
    return full
  }

  // Domain terms go first: the runner's domain filter still enforces them on the results.
  return fitDeepSeekQuery(request.query, dateTerms)
}

function fitDeepSeekQuery(query: string, dateTerms: readonly string[]): string {
  const suffix = dateTerms.join(' ')
  const budget = DEEPSEEK_QUERY_MAX_CHARS - (suffix === '' ? 0 : codePointLength(suffix) + 1)
  const words = query.split(WHITESPACE_RE)

  while (words.length > 1 && codePointLength(words.join(' ')) > budget) {
    words.pop()
  }

  const fitted = Array.from(words.join(' ')).slice(0, budget).join('')

  return [fitted, ...dateTerms].join(' ')
}

function deepSeekDateTerms(request: SearchRequest, nowMs: number): readonly string[] {
  const { recency, freshness } = request
  const pushed = isPublishedFreshness(freshness)
  const researchStart = pushed ? freshness?.fromOn : undefined
  const startDay =
    recency === undefined
      ? researchStart
      : dayInZone(nowMs - RECENCY_DAYS[recency] * MS_PER_DAY, DEEPSEEK_TIME_ZONE)
  const endDay = pushed ? freshness?.toOn : undefined

  return [
    ...(startDay === undefined ? [] : [`after:${startDay}`]),
    ...(endDay === undefined ? [] : [`before:${endDay}`]),
  ]
}

// DeepSeek returns only one site for `site:a OR site:b` and nothing for a parenthesised group,
// so two or more include domains are left to the runner's filter.
function deepSeekDomainTerms(request: SearchRequest): readonly string[] {
  const [onlyDomain, ...otherDomains] = request.includeDomains ?? []
  const include =
    onlyDomain !== undefined && otherDomains.length === 0 ? [`site:${onlyDomain}`] : []

  return [...include, ...(request.excludeDomains ?? []).map((domain) => `-site:${domain}`)]
}

function toDeepSeekItems(value: unknown): readonly unknown[] {
  if (!(isPlainRecord(value) && Array.isArray(value.results))) {
    return []
  }

  return value.results.map((item: unknown) => {
    if (!isPlainRecord(item)) {
      return item
    }

    const publishedOn = toDeepSeekDay(item.date)

    return {
      title: item.title,
      url: item.url,
      snippet:
        typeof item.summary === 'string' && item.summary !== '' ? item.summary : item.snippet,
      ...(publishedOn === undefined ? {} : { publishedOn }),
    }
  })
}

function toDeepSeekDay(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const ms = Date.parse(value)

  return Number.isNaN(ms) ? undefined : dayInZone(ms, DEEPSEEK_TIME_ZONE)
}

function codePointLength(text: string): number {
  return Array.from(text).length
}
