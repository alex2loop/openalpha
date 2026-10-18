import type { ResearchFreshness } from '@/engine/api'
import type { SearchBackendResponse, SearchRequest, SearchResult } from '@/tools/web/search/types'
import { isPlainRecord } from '@/core/utils/collections'
import { truncate } from '@/core/utils/text'
import { ZERO_PROVIDER_COST_USD } from '@/tools/web/search/types'

const RESULT_TITLE_MAX_CHARS = 1_000
const RESULT_URL_MAX_CHARS = 2_048
const RESULT_SNIPPET_MAX_CHARS = 4_000

interface SearchResultFields {
  readonly title: string
  readonly url: string
  readonly snippet: string
  readonly publishedOn?: string
}

export function toSearchResults(
  value: unknown,
  fields: SearchResultFields,
  limit: number
): readonly SearchResult[] {
  if (!Array.isArray(value)) {
    return []
  }

  const out: SearchResult[] = []
  for (const item of value) {
    if (!isPlainRecord(item)) {
      continue
    }

    const title = toText(item[fields.title])
    const url = toText(item[fields.url])
    if (title === '' || url === '') {
      continue
    }

    const publishedOn = fields.publishedOn === undefined ? '' : toText(item[fields.publishedOn])

    out.push({
      title: title.slice(0, RESULT_TITLE_MAX_CHARS),
      url: url.slice(0, RESULT_URL_MAX_CHARS),
      snippet: toSnippetText(item[fields.snippet]).slice(0, RESULT_SNIPPET_MAX_CHARS),
      ...(publishedOn === '' ? {} : { publishedOn }),
      highlights: [],
      engines: [],
    })
    if (out.length >= limit) {
      break
    }
  }

  return out
}

export function toFreeSearchResponse(
  results: readonly SearchResult[],
  request: SearchRequest
): SearchBackendResponse {
  return {
    results,
    costUsd: ZERO_PROVIDER_COST_USD,
    freshness: freeFreshness(request),
  }
}

export function withPushedFreshness(
  response: SearchBackendResponse,
  request: SearchRequest
): SearchBackendResponse {
  if (request.recency === undefined && request.freshness === undefined) {
    return response
  }

  const pushedDown = request.recency !== undefined || isPublishedFreshness(request.freshness)

  return { ...response, freshness: pushedDown ? 'pushed_down' : 'unverified' }
}

export function isPublishedFreshness(freshness: ResearchFreshness | undefined): boolean {
  return freshness?.field === 'publishedOn' || freshness?.field === 'either'
}

export function capSearchResults(
  results: readonly SearchResult[],
  snippetMaxChars: number
): readonly SearchResult[] {
  return results.map((result) => ({
    ...result,
    snippet: truncate(result.snippet, snippetMaxChars),
  }))
}

function freeFreshness(request: SearchRequest): SearchBackendResponse['freshness'] {
  if (request.recency !== undefined) {
    return 'pushed_down'
  }

  return request.freshness === undefined ? 'not_requested' : 'unverified'
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toSnippetText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (!Array.isArray(value)) {
    return ''
  }

  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }

    const text = item.trim()

    if (text !== '') {
      return text
    }
  }

  return ''
}
