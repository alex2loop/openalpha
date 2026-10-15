import type { ExaSearchType } from '@/core/config/resolve'
import type { ResearchContentsFailure, ResearchContentsItem } from '@/engine/api'
import type {
  ExaContentsResponse,
  SearchBackendResponse,
  SearchResult,
} from '@/tools/web/search/types'
import { isPlainRecord } from '@/core/utils/collections'
import { SearchProviderError } from '@/tools/web/search/errors'

export const EXA_API_ORIGIN = 'https://api.exa.ai'
export const EXA_SEARCH_PATH = '/search'
export const EXA_CONTENTS_PATH = '/contents'
export const EXA_AUTHORIZATION_HEADER = 'Authorization'
export const EXA_BEARER_PREFIX = 'Bearer '

const EXA_HIGHLIGHT_MAX_CHARACTERS = 1_000
const ISO_DAY_LENGTH = 10
const ISO_UTC_DATE_TIME_RE =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})\.(?<millisecond>\d{3})Z$/
const REQUEST_ID_MAX_CHARACTERS = 500
const RESOLVED_TYPE_MAX_CHARACTERS = 100
const RESULT_TITLE_MAX_CHARACTERS = 1_000
const RESULT_URL_MAX_CHARACTERS = 2_048
const RESULT_AUTHOR_MAX_CHARACTERS = 1_000
const ERROR_TAG_MAX_CHARACTERS = 100

interface ExaContentsBodyInput {
  readonly urls: readonly string[]
  readonly query: string
  readonly textMaxCharacters: number
  readonly excerptMaxCharacters: number
}

export function exaSearchBody(request: {
  readonly query: string
  readonly maxResults: number
  readonly exaSearchType?: ExaSearchType
  readonly includeDomains?: readonly string[]
  readonly excludeDomains?: readonly string[]
  readonly startPublishedDate?: string
  readonly endPublishedDate?: string
}): string {
  return JSON.stringify({
    query: request.query,
    numResults: request.maxResults,
    type: request.exaSearchType ?? 'auto',
    ...(request.includeDomains === undefined ? {} : { includeDomains: request.includeDomains }),
    ...(request.excludeDomains === undefined ? {} : { excludeDomains: request.excludeDomains }),
    ...(request.startPublishedDate === undefined
      ? {}
      : { startPublishedDate: request.startPublishedDate }),
    ...(request.endPublishedDate === undefined
      ? {}
      : { endPublishedDate: request.endPublishedDate }),
    contents: { highlights: { maxCharacters: EXA_HIGHLIGHT_MAX_CHARACTERS } },
  })
}

export function exaContentsBody(input: ExaContentsBodyInput): string {
  return JSON.stringify({
    urls: input.urls,
    text: { maxCharacters: input.textMaxCharacters },
    highlights: { query: input.query, maxCharacters: input.excerptMaxCharacters },
  })
}

export function parseExaSearchResponse(
  value: unknown,
  requestedSearchType: ExaSearchType,
  maxResults: number
): SearchBackendResponse {
  if (!isPlainRecord(value)) {
    throw invalidExaResponse('Exa Search response must be an object')
  }
  const costUsd = parseCost(value.costDollars)
  if (!Array.isArray(value.results)) {
    throw invalidExaResponse('Exa Search response is missing results', costUsd)
  }
  const requestId = requiredString(value.requestId, 'requestId', costUsd).slice(
    0,
    REQUEST_ID_MAX_CHARACTERS
  )
  const resolvedSearchType = resolveSearchType(value, costUsd)
  const results = value.results
    .slice(0, maxResults)
    .map((result) => parseSearchResult(result, costUsd))

  return {
    results,
    costUsd,
    freshness: 'not_requested',
    requestId,
    requestedSearchType,
    ...(resolvedSearchType === undefined ? {} : { resolvedSearchType }),
  }
}

export function parseExaContentsResponse(value: unknown, retrievedAt: number): ExaContentsResponse {
  if (!isPlainRecord(value)) {
    throw invalidExaResponse('Exa Contents response must be an object')
  }
  const costUsd = parseCost(value.costDollars)
  if (!(Array.isArray(value.results) && Array.isArray(value.statuses))) {
    throw invalidExaResponse('Exa Contents response is missing results or statuses', costUsd)
  }
  const requestId = requiredString(value.requestId, 'requestId', costUsd).slice(
    0,
    REQUEST_ID_MAX_CHARACTERS
  )
  const items = value.results.map((result) => parseContentsItem(result, retrievedAt, costUsd))
  const failures = value.statuses.flatMap((status) => parseContentsFailure(status, costUsd))

  return { items, failures, costUsd, requestId }
}

function parseSearchResult(value: unknown, costUsd: number): SearchResult {
  if (!isPlainRecord(value)) {
    throw invalidExaResponse('Exa Search result must be an object', costUsd)
  }

  const title = requiredString(value.title, 'results.title', costUsd).slice(
    0,
    RESULT_TITLE_MAX_CHARACTERS
  )
  const url = requiredString(value.url, 'results.url', costUsd).slice(0, RESULT_URL_MAX_CHARACTERS)
  const author = optionalString(value.author, 'results.author', costUsd)?.slice(
    0,
    RESULT_AUTHOR_MAX_CHARACTERS
  )
  const publishedOn = parsePublishedOn(value.publishedDate, costUsd)
  const highlights = parseHighlights(value.highlights, value.highlightScores, costUsd)

  return {
    title,
    url,
    snippet: highlights.map((highlight) => highlight.text).join('\n'),
    highlights,
    engines: [],
    ...(author === undefined ? {} : { author }),
    ...(publishedOn === undefined ? {} : { publishedOn }),
  }
}

function parseContentsItem(
  value: unknown,
  retrievedAt: number,
  costUsd: number
): ResearchContentsItem {
  if (!isPlainRecord(value)) {
    throw invalidExaResponse('Exa Contents result must be an object', costUsd)
  }

  const canonicalUrl = normalizeUrl(
    requiredString(value.url, 'results.url', costUsd).slice(0, RESULT_URL_MAX_CHARACTERS),
    costUsd
  )
  const text = requiredText(value.text, 'results.text', costUsd)

  return { canonicalUrl, retrievedAt, text }
}

function parseContentsFailure(value: unknown, costUsd: number): readonly ResearchContentsFailure[] {
  if (!isPlainRecord(value)) {
    throw invalidExaResponse('Exa Contents status must be an object', costUsd)
  }

  const canonicalUrl = normalizeUrl(
    requiredString(value.id, 'statuses.id', costUsd).slice(0, RESULT_URL_MAX_CHARACTERS),
    costUsd
  )
  const status = requiredString(value.status, 'statuses.status', costUsd)

  if (status === 'success') {
    return []
  }

  if (status !== 'error' || !isPlainRecord(value.error)) {
    throw invalidExaResponse('Exa Contents status is invalid', costUsd)
  }

  const errorTag = requiredString(value.error.tag, 'statuses.error.tag', costUsd).slice(
    0,
    ERROR_TAG_MAX_CHARACTERS
  )
  const httpStatus = optionalHttpStatus(value.error.httpStatusCode, costUsd)

  return [{ canonicalUrl, errorTag, ...(httpStatus === undefined ? {} : { httpStatus }) }]
}

function parseHighlights(
  highlightsValue: unknown,
  scoresValue: unknown,
  costUsd: number
): SearchResult['highlights'] {
  if (highlightsValue === undefined || highlightsValue === null) {
    // Scores without highlights are provider drift; absent scores are fine — Exa removed
    // highlightScores from /search responses in May 2026.
    if (scoresValue !== undefined && scoresValue !== null) {
      throw invalidExaResponse('Exa highlight scores without highlights', costUsd)
    }

    return []
  }

  if (!Array.isArray(highlightsValue)) {
    throw invalidExaResponse('Exa highlights are invalid', costUsd)
  }

  const scores = parseHighlightScores(scoresValue, highlightsValue.length, costUsd)

  return highlightsValue.map((highlight, index) => {
    const text = requiredString(highlight, 'results.highlights', costUsd)
    const score = scores?.[index]

    return {
      text: text.slice(0, EXA_HIGHLIGHT_MAX_CHARACTERS),
      index,
      ...(score === undefined ? {} : { score }),
    }
  })
}

function parseHighlightScores(
  value: unknown,
  expectedCount: number,
  costUsd: number
): readonly number[] | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw invalidExaResponse('Exa highlights and scores must be paired', costUsd)
  }

  return value.map((score) => {
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) {
      throw invalidExaResponse('Exa highlight score is invalid', costUsd)
    }

    return score
  })
}

function parseCost(value: unknown): number {
  if (!isPlainRecord(value) || typeof value.total !== 'number') {
    throw invalidExaResponse('Exa response is missing costDollars.total')
  }

  if (!Number.isFinite(value.total) || value.total < 0) {
    throw invalidExaResponse('Exa response has invalid costDollars.total')
  }

  return value.total
}

function parsePublishedOn(value: unknown, costUsd: number): string | undefined {
  const publishedDate = optionalString(value, 'results.publishedDate', costUsd)

  if (publishedDate === undefined) {
    return undefined
  }

  const match = ISO_UTC_DATE_TIME_RE.exec(publishedDate)

  if (match?.groups === undefined) {
    throw invalidExaResponse('Exa publishedDate is invalid', costUsd)
  }

  const { year, month, day, hour, minute, second, millisecond } = match.groups
  const parsed = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond)
  )
  const canonical = new Date(parsed).toISOString()

  if (canonical !== publishedDate) {
    throw invalidExaResponse('Exa publishedDate is invalid', costUsd)
  }

  return canonical.slice(0, ISO_DAY_LENGTH)
}

// Exa renamed resolvedSearchType to searchType; the old field lingers as an empty placeholder.
function resolveSearchType(value: Record<string, unknown>, costUsd: number): string | undefined {
  const resolved = optionalString(
    value.searchType ?? value.resolvedSearchType,
    'searchType',
    costUsd
  )

  return resolved === undefined || resolved === ''
    ? undefined
    : resolved.slice(0, RESOLVED_TYPE_MAX_CHARACTERS)
}

function requiredString(value: unknown, field: string, costUsd?: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidExaResponse(`Exa response field ${field} is invalid`, costUsd)
  }

  return value.trim()
}

function requiredText(value: unknown, field: string, costUsd: number): string {
  if (typeof value !== 'string') {
    throw invalidExaResponse(`Exa response field ${field} is invalid`, costUsd)
  }

  return value
}

function optionalString(value: unknown, field: string, costUsd: number): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw invalidExaResponse(`Exa response field ${field} is invalid`, costUsd)
  }

  return value
}

function optionalHttpStatus(value: unknown, costUsd: number): number | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 599) {
    throw invalidExaResponse('Exa Contents HTTP status is invalid', costUsd)
  }

  return value
}

function normalizeUrl(value: string, costUsd: number): string {
  try {
    const url = new URL(value)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw invalidExaResponse('Exa result URL has an unsupported protocol', costUsd)
    }

    url.hash = ''
    return url.toString()
  } catch (error: unknown) {
    if (error instanceof SearchProviderError) {
      throw error
    }

    throw invalidExaResponse('Exa result URL is invalid', costUsd)
  }
}

function invalidExaResponse(message: string, costUsd?: number): SearchProviderError {
  return new SearchProviderError('invalid_response', message, {
    ...(costUsd === undefined ? {} : { costUsd }),
  })
}
