import TurndownService from 'turndown'

import type { ResearchDirectFetchOutcome, ResearchProviderFailureCode } from '@/engine/api'
import { abortError, ToolError } from '@/core/errors'
import { readTruncatedText } from '@/core/http-client'
import { scanOutput } from '@/core/security/sanitize'
import { NetworkPolicy } from '@/core/ssrf/network-policy'
import { stripControls, stripMarkup, truncateUtf8HeadTail } from '@/core/utils/text'

import type { GeneralFetchInput, GeneralFetchOutcome, WebExtractMode } from './retrieval-service'

const TEXT_MEDIA_TYPES = Object.freeze([
  'application/json',
  'application/xml',
  'text/xml',
  'application/rss+xml',
  'application/atom+xml',
])
const EMPTY_BODY_GUIDANCE =
  'Page returned no readable text. Prefer a direct textual source or web_search.'
// Link text and target exclude `[` so a scan from each `[` stops at the next one.
const MD_IMAGE_RE = /!\[([^[\]]*)\]\([^[)]*\)/g
const MD_LINK_RE = /\[([^[\]]+)\]\([^[)]*\)/g
const MD_HEADING_RE = /^#{1,6}\s+(.*)$/gm
const MD_EMPHASIS_RE = /([*_]{1,3})([^*_\n]+)\1/g
const MD_BLOCKQUOTE_RE = /^>\s?(.*)$/gm
const MD_CODE_FENCE_RE = /^(?:```|~~~)[^\n]*\n?/gm
const MD_LIST_MARKER_RE = /^[ \t]*(?:[-+*]|\d+[.)])\s+/gm
const MD_INLINE_CODE_RE = /`{1,8}([^`\n]+)`{1,8}/g
const MD_HORIZONTAL_RULE_RE = /^[ \t]*(?:[-*_][ \t]*){3,}$/gm
const MD_STRIKETHROUGH_RE = /~~([^~\n]+)~~/g
const WHITESPACE_RE = /[ \t]+/g
const BLANK_LINE_RUN_RE = /\n{3,}/g
const SECURITY_NOTICE = 'Security notice: untrusted instructions were detected in this source.'

// Elements whose content is code or fallback markup, never page text.
const NON_CONTENT_TAGS = ['script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed']

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).remove(
  NON_CONTENT_TAGS
)

interface ConsumePageInput {
  readonly response: Response
  readonly mode: WebExtractMode
  readonly method: 'GET' | 'HEAD'
  /** Final hop after redirects — a pinned response carries no url of its own. */
  readonly finalUrl: string
  readonly maxBytes: number
  readonly publishedDayOf?: (markup: string) => string | undefined
}

export async function fetchGeneralPage(
  input: GeneralFetchInput,
  maxBytes: number
): Promise<GeneralFetchOutcome> {
  assertPageFetchActive(input.signal)
  return await fetchPage(input, maxBytes)
}

export async function fetchDirectPage(input: {
  readonly url: string
  readonly timeoutMs: number
  readonly maxReadBytes: number
  readonly maxBytes: number
  readonly publishedDayOf: (markup: string) => string | undefined
  readonly signal: AbortSignal
}): Promise<{
  readonly canonicalUrl: string
  readonly retrievedAt: number
  readonly text: string
  readonly publishedDay?: string
}> {
  assertPageFetchActive(input.signal)
  const outcome = await fetchPage(
    {
      url: input.url,
      method: 'GET',
      extractMode: 'text',
      timeoutMs: input.timeoutMs,
      publishedDayOf: input.publishedDayOf,
      signal: input.signal,
    },
    input.maxReadBytes
  )

  return {
    canonicalUrl: outcome.url,
    retrievedAt: outcome.retrievedAt,
    text: truncateUtf8HeadTail(sanitizeRetrievedText(outcome.body), input.maxBytes),
    ...(outcome.publishedDay === undefined ? {} : { publishedDay: outcome.publishedDay }),
  }
}

function sanitizeRetrievedText(text: string): string {
  return applySecurityScan(stripProviderText(text))
}

// Prompt-injection scan shared by every retrieved-page path: the research direct-fetch path runs
// it over stripped plain text, and the general web_fetch path (raw/markdown/text) runs it over
// whatever extractContent produced, without the destructive formatting strip that only the
// direct-fetch text mode wants.
function applySecurityScan(text: string): string {
  return scanOutput(text).length === 0 ? text : `${SECURITY_NOTICE}\n${text}`
}

function stripProviderText(text: string): string {
  return stripMarkup(stripControls(text))
    .replace(WHITESPACE_RE, ' ')
    .replace(BLANK_LINE_RUN_RE, '\n\n')
    .trim()
}

export function canonicalHttpsUrl(value: string): string {
  try {
    const url = new URL(value)

    if (url.protocol !== 'https:') {
      throw new ToolError('host_blocked', 'only HTTPS URLs are allowed')
    }

    if (url.username !== '' || url.password !== '') {
      throw new ToolError('host_blocked', 'URL credentials are not allowed')
    }

    url.hash = ''
    return url.toString()
  } catch (error: unknown) {
    if (error instanceof ToolError) {
      throw error
    }

    throw new ToolError('invalid_input', 'URL is invalid')
  }
}

export function directFetchAttempt(
  canonicalUrl: string,
  outcome: 'success' | 'cache_hit',
  latencyMs: number
): Extract<ResearchDirectFetchOutcome, { readonly kind: 'content' }>['attempt'] {
  return {
    transport: 'direct',
    operation: 'fetch',
    canonicalUrl,
    outcome,
    latencyMs,
    costUsd: 0,
  }
}

export function directFetchFailure(
  canonicalUrl: string,
  startedAt: number,
  failureCode: ResearchProviderFailureCode
): ResearchDirectFetchOutcome {
  return {
    kind: 'failed',
    attempt: {
      transport: 'direct',
      operation: 'fetch',
      canonicalUrl,
      outcome: 'failed',
      latencyMs: Math.max(0, performance.now() - startedAt),
      costUsd: 0,
      failureCode,
    },
  }
}

export function directFetchFailureCode(error: unknown): ResearchProviderFailureCode {
  if (error instanceof ToolError) {
    if (error.code === 'timeout') {
      return 'timeout'
    }

    if (error.code === 'payload_too_large') {
      return 'content_limit'
    }

    if (error.code === 'binary_content') {
      return 'content_unavailable'
    }
  }

  return 'transport'
}

async function fetchPage(input: GeneralFetchInput, maxBytes: number): Promise<GeneralFetchOutcome> {
  assertPageFetchActive(input.signal)
  const canonicalUrl = canonicalHttpsUrl(input.url)
  const timeoutController = new AbortController()
  const timeout = setTimeout(
    () => timeoutController.abort(new ToolError('timeout', 'web fetch timed out')),
    input.timeoutMs
  )
  const signal = AbortSignal.any([input.signal, timeoutController.signal])

  try {
    const guarded = await NetworkPolicy.guardedFetch(
      canonicalUrl,
      {
        method: input.method,
        ...(input.headers === undefined ? {} : { headers: input.headers }),
        signal,
      },
      input.allowedHosts === undefined ? undefined : { allowlist: input.allowedHosts }
    )

    return await consumePage({
      response: guarded.response,
      mode: input.extractMode,
      method: input.method,
      finalUrl: guarded.finalUrl,
      maxBytes,
      ...(input.publishedDayOf === undefined ? {} : { publishedDayOf: input.publishedDayOf }),
    })
  } catch (error: unknown) {
    if (timeoutController.signal.aborted && !input.signal.aborted) {
      throw new ToolError('timeout', 'web fetch timed out')
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function consumePage(input: ConsumePageInput): Promise<GeneralFetchOutcome> {
  const { response, mode, method, finalUrl, maxBytes } = input
  if (!response.ok) {
    await cancelBody(response)
    throw new ToolError('unexpected', `HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  const retrievedAt = Date.now()
  const base = {
    url: finalUrl,
    status: response.status,
    contentType,
    retrievedAt,
  }

  if (method === 'HEAD') {
    await cancelBody(response)
    return { ...base, body: '' }
  }

  const mediaType = toMediaType(contentType)

  await assertTextContentType(response, contentType, mediaType)
  const { text: raw, truncated } = await readTruncatedText(response, maxBytes)
  const body = applySecurityScan(extractContent(mode, mediaType, raw))
  const publishedDay = isHtmlMediaType(mediaType) ? input.publishedDayOf?.(raw) : undefined
  const outcome = {
    ...base,
    body,
    ...(truncated ? { truncated } : {}),
    ...(publishedDay === undefined ? {} : { publishedDay }),
  }

  return body.trim() === '' ? { ...outcome, guidance: EMPTY_BODY_GUIDANCE } : outcome
}

async function assertTextContentType(
  response: Response,
  contentType: string,
  mediaType: string
): Promise<void> {
  if (mediaType.startsWith('text/') || TEXT_MEDIA_TYPES.includes(mediaType)) {
    return
  }

  await cancelBody(response)
  throw new ToolError(
    'binary_content',
    `non-text content type rejected: ${contentType || 'unknown'}`
  )
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

function extractContent(mode: WebExtractMode, mediaType: string, body: string): string {
  if (mode === 'raw') {
    return body
  }

  const markdown = isHtmlMediaType(mediaType) ? turndown.turndown(body) : body
  return mode === 'markdown' ? markdown.trim() : toPlainText(markdown)
}

function toPlainText(markdown: string): string {
  return markdown
    .replace(MD_IMAGE_RE, '$1')
    .replace(MD_LINK_RE, '$1')
    .replace(MD_HEADING_RE, '$1')
    .replace(MD_EMPHASIS_RE, '$2')
    .replace(MD_BLOCKQUOTE_RE, '$1')
    .replace(MD_CODE_FENCE_RE, '')
    .replace(MD_LIST_MARKER_RE, '')
    .replace(MD_INLINE_CODE_RE, '$1')
    .replace(MD_HORIZONTAL_RULE_RE, '')
    .replace(MD_STRIKETHROUGH_RE, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toMediaType(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? ''
}

function isHtmlMediaType(mediaType: string): boolean {
  return mediaType === 'text/html' || mediaType === 'application/xhtml+xml'
}

function assertPageFetchActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError(signal)
  }
}
