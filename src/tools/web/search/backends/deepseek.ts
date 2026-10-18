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
// Below this, a trimmed query has lost its subject, and the site list is the better thing to drop.
const DEEPSEEK_QUERY_MIN_CHARS = 40
const DEEPSEEK_SITE_SEPARATOR = ' OR '
// Results are dated at midnight Beijing time, and after:/before: read their day in the same zone.
const DEEPSEEK_TIME_ZONE = 'Asia/Shanghai'
const DEEPSEEK_FIELDS = {
  title: 'title',
  url: 'url',
  snippet: 'snippet',
  publishedOn: 'publishedOn',
} as const
const WHITESPACE_RE = /\s+/
// Most summaries open by repeating the result title as a markdown heading.
const LEADING_HEADING_RE = /^#[^\n]*(?:\n|$)/

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
  const dateTerms = buildDeepSeekDateTerms(request, nowMs)
  const includeTerms = buildDeepSeekIncludeTerms(request)
  const excludeTerms = (request.excludeDomains ?? []).map((domain) => `-site:${domain}`)
  const full = [request.query, ...includeTerms, ...excludeTerms, ...dateTerms].join(' ')

  if (codePointLength(full) <= DEEPSEEK_QUERY_MAX_CHARS) {
    return full
  }

  // Exclusions are dropped first; without the site list most results would be filtered out.
  const withSites = [...includeTerms, ...dateTerms]

  return fitDeepSeekQuery(request.query, leavesQueryRoom(withSites) ? withSites : dateTerms)
}

function buildDeepSeekDateTerms(request: SearchRequest, nowMs: number): readonly string[] {
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

function buildDeepSeekIncludeTerms(request: SearchRequest): readonly string[] {
  const domains = request.includeDomains ?? []

  return domains.length === 0
    ? []
    : [domains.map((domain) => `site:${domain}`).join(DEEPSEEK_SITE_SEPARATOR)]
}

function leavesQueryRoom(terms: readonly string[]): boolean {
  return queryBudget(terms) >= DEEPSEEK_QUERY_MIN_CHARS
}

function queryBudget(terms: readonly string[]): number {
  const suffix = terms.join(' ')

  return DEEPSEEK_QUERY_MAX_CHARS - (suffix === '' ? 0 : codePointLength(suffix) + 1)
}

function fitDeepSeekQuery(query: string, terms: readonly string[]): string {
  const budget = queryBudget(terms)
  const words = query.trim().split(WHITESPACE_RE)

  while (words.length > 1 && codePointLength(words.join(' ')) > budget) {
    words.pop()
  }

  const fitted = Array.from(words.join(' ')).slice(0, budget).join('')

  return [fitted, ...terms].join(' ')
}

function toDeepSeekItems(value: unknown): readonly unknown[] {
  if (!(isPlainRecord(value) && Array.isArray(value.results))) {
    return []
  }

  return value.results.map(toDeepSeekItem)
}

function toDeepSeekItem(item: unknown): unknown {
  if (!isPlainRecord(item)) {
    return item
  }

  const publishedOn = toDeepSeekDay(item.date)

  return {
    title: item.title,
    url: item.url,
    snippet: toDeepSeekSnippet(item),
    ...(publishedOn === undefined ? {} : { publishedOn }),
  }
}

function toDeepSeekDay(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const ms = Date.parse(value)

  return Number.isNaN(ms) ? undefined : dayInZone(ms, DEEPSEEK_TIME_ZONE)
}

function toDeepSeekSnippet(item: Readonly<Record<string, unknown>>): unknown {
  if (typeof item.summary !== 'string') {
    return item.snippet
  }

  const text = item.summary.replace(LEADING_HEADING_RE, '').trim().split(WHITESPACE_RE).join(' ')

  return text === '' ? item.snippet : text
}

function codePointLength(text: string): number {
  return Array.from(text).length
}
