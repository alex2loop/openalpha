import type { SearchBackend, SearchResult } from '@/tools/web/search/types'
import { abortError } from '@/core/errors'
import {
  BROWSER_HEADERS,
  HttpRequestError,
  keylessGetWithSignal,
  parseRetryAfterMs,
} from '@/core/http-client'
import { toDomainQuery } from '@/tools/web/search/domains'
import {
  isSearchRetryableStatus,
  SEARCH_RETRY_AFTER_MAX_MS,
  SearchRetryableError,
} from '@/tools/web/search/errors'
import { toFreeSearchResponse } from '@/tools/web/search/result-parser'

export const DUCKDUCKGO_HOST = 'https://html.duckduckgo.com'
const DUCKDUCKGO_PATH = '/html/'
const RECENCY_TO_DUCKDUCKGO = { day: 'd', week: 'w', month: 'm', year: 'y' } as const

const RESULT_BLOCK_RE = /<div class="result results_links[^"]*"[^>]*>.*?<\/div>\s*<\/div>/gis
const TITLE_RE = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/is
const SNIPPET_RE = /<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/is
const CHALLENGE_RE =
  /class="challenge"|id="challenge-form"|Please wait while we try to load this page/i
const TAG_RE = /<[^>]+>/g
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
}

export const duckduckgoSearch: SearchBackend = async (request) => {
  if (request.signal.aborted) {
    throw abortError(request.signal)
  }

  const query = {
    q: toDomainQuery(request),
    ...(request.recency === undefined ? {} : { df: RECENCY_TO_DUCKDUCKGO[request.recency] }),
  }

  try {
    const html = await keylessGetWithSignal({
      hosts: [DUCKDUCKGO_HOST],
      path: DUCKDUCKGO_PATH,
      query,
      // The HTML endpoint serves a challenge page to anything that does not read as a browser.
      headers: BROWSER_HEADERS,
      signal: request.signal,
      toolName: 'web_search',
    })

    if (CHALLENGE_RE.test(html)) {
      throw new SearchRetryableError('DuckDuckGo challenge page', { retryAfterMs: 0 })
    }

    return toFreeSearchResponse(parseResults(html, request.maxResults), request)
  } catch (err: unknown) {
    if (err instanceof HttpRequestError) {
      const retryable = classifyDuckDuckGoError(err)
      if (retryable !== undefined) {
        throw retryable
      }
    }

    throw err
  }
}

function parseResults(html: string, limit: number): readonly SearchResult[] {
  const out: SearchResult[] = []
  for (const block of html.matchAll(RESULT_BLOCK_RE)) {
    const result = parseBlock(block[0] ?? '')
    if (result !== undefined) {
      out.push(result)
    }
    if (out.length >= limit) {
      break
    }
  }
  return out
}

function classifyDuckDuckGoError(err: HttpRequestError): SearchRetryableError | undefined {
  if (err.status === undefined || !isSearchRetryableStatus(err.status)) {
    return undefined
  }

  const nowMs = Date.now()
  const retryAfterMs = parseRetryAfterMs(err.retryAfter, nowMs, SEARCH_RETRY_AFTER_MAX_MS) ?? 0

  return new SearchRetryableError('DuckDuckGo is temporarily unavailable', {
    retryAfterMs,
    failureCode: err.status === 429 ? 'rate_limited' : 'transport',
    code: err.code,
  })
}

function parseBlock(block: string): SearchResult | undefined {
  const titleMatch = TITLE_RE.exec(block)
  const snippetMatch = SNIPPET_RE.exec(block)
  TITLE_RE.lastIndex = 0
  SNIPPET_RE.lastIndex = 0

  if (titleMatch === null) {
    return undefined
  }

  const title = decodeHtmlEntities(stripTags(titleMatch[2] ?? '')).trim()
  const rawUrl = titleMatch[1] ?? ''
  const url = unwrapDuckDuckGoUrl(rawUrl)
  const snippet =
    snippetMatch === null ? '' : decodeHtmlEntities(stripTags(snippetMatch[1] ?? '')).trim()

  if (title === '' || url === '') {
    return undefined
  }

  return { title, url, snippet, highlights: [], engines: [] }
}

function stripTags(html: string): string {
  return html.replace(TAG_RE, '')
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code)
      return isValidCodePoint(n) ? String.fromCodePoint(n) : `&#${code};`
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = Number.parseInt(code, 16)
      return isValidCodePoint(n) ? String.fromCodePoint(n) : `&#x${code};`
    })
    .replace(/&([a-z][a-z0-9]*);/gi, (_, name) => NAMED_ENTITIES[name] ?? `&${name};`)
}

function isValidCodePoint(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 0x10_ffff && (n < 0xd800 || n > 0xdfff)
}

function unwrapDuckDuckGoUrl(raw: string): string {
  try {
    const url = new URL(raw, DUCKDUCKGO_HOST)

    if (url.hostname !== 'duckduckgo.com' && url.hostname !== 'html.duckduckgo.com') {
      return raw
    }

    const uddg = url.searchParams.get('uddg')

    if (uddg === null) {
      return raw
    }

    const unwrapped = decodeURIComponent(uddg)
    const unwrappedUrl = new URL(unwrapped)

    return unwrappedUrl.protocol === 'https:' ? unwrappedUrl.href : raw
  } catch {
    return raw
  }
}
