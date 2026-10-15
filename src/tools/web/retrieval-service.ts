import type {
  ResolvedConfig,
  ResolvedSearchProvider,
  WebSearchProvider,
} from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type {
  ResearchContentsInput,
  ResearchContentsOutcome,
  ResearchDirectFetchInput,
  ResearchDirectFetchOutcome,
  ResearchRetrieval,
  ResearchRetrievalCall,
  ResearchSearchInput,
  ResearchSearchOutcome,
} from '@/engine/api'
import { abortError, ToolError } from '@/core/errors'
import { anysearchSearch } from '@/tools/web/search/backends/anysearch'
import { braveSearch } from '@/tools/web/search/backends/brave'
import { duckduckgoSearch } from '@/tools/web/search/backends/duckduckgo'
import { exaSearch } from '@/tools/web/search/backends/exa'
import { exaContents } from '@/tools/web/search/backends/exa-contents'
import { searxngSearch } from '@/tools/web/search/backends/searxng'
import { serperSearch } from '@/tools/web/search/backends/serper'
import { tavilySearch } from '@/tools/web/search/backends/tavily'
import { normalizeProviderUrls } from '@/tools/web/search/domains'
import { createProviderRunner } from '@/tools/web/search/provider-runner'
import { capSearchResults } from '@/tools/web/search/result-parser'

import type { ProviderRunner, Recency, SearchBackend, SearchResult } from './search/types'
import {
  canonicalHttpsUrl,
  directFetchAttempt,
  directFetchFailure,
  directFetchFailureCode,
  fetchDirectPage,
  fetchGeneralPage,
} from './page-fetch'
import { defaultSearchProvider, toSearchRequest } from './retrieval-request'

const GENERAL_WEB_MAX_BYTES = 2_097_152
const EXA_CONTENTS_URL_MAX = 100
const EXA_RESPONSE_METADATA_BYTES = 64 * 1_024
const MAX_UTF8_BYTES_PER_CHARACTER = 4
// Raw HTML commonly runs 5-50x the extracted article text; the per-source text cap is applied
// after extraction, so the transport read needs its own, larger bound.
const DIRECT_FETCH_MAX_READ_BYTES = 1_024 * 1_024

const PROVIDERS = {
  anysearch: anysearchSearch,
  brave: braveSearch,
  duckduckgo: duckduckgoSearch,
  exa: exaSearch,
  searxng: searxngSearch,
  serper: serperSearch,
  tavily: tavilySearch,
} as const satisfies Readonly<Record<WebSearchProvider, SearchBackend>>

const IMPLICIT_DUCKDUCKGO = Object.freeze({ provider: 'duckduckgo' as const })

export type WebExtractMode = 'raw' | 'markdown' | 'text'

interface GeneralSearchInput extends ResearchRetrievalCall {
  readonly query: string
  readonly maxResults: number
  readonly locale: Locale
  readonly recency?: Recency
  readonly safeSearch?: 0 | 1 | 2
  readonly includeDomains?: readonly string[]
  readonly excludeDomains?: readonly string[]
}

export interface GeneralFetchInput {
  readonly url: string
  readonly method: 'GET' | 'HEAD'
  readonly extractMode: WebExtractMode
  readonly timeoutMs: number
  readonly signal: AbortSignal
  readonly headers?: Readonly<Record<string, string>>
  readonly allowedHosts?: readonly string[]
  /** Reads a published day from HTML markup before it is converted to the requested mode. */
  readonly publishedDayOf?: (markup: string) => string | undefined
}

export interface GeneralFetchOutcome {
  readonly url: string
  readonly status: number
  readonly contentType: string
  readonly retrievedAt: number
  readonly body: string
  readonly guidance?: string
  /** The body was cut at the read cap; the page continues past it. */
  readonly truncated?: boolean
  /** The page's own published day from its markup, read before conversion. */
  readonly publishedDay?: string
}

export interface WebRetrievalService extends ResearchRetrieval {
  searchGeneral(input: GeneralSearchInput): Promise<readonly SearchResult[]>
  fetchGeneral(input: GeneralFetchInput): Promise<GeneralFetchOutcome>
}

interface WebRetrievalState {
  readonly config: ResolvedConfig
  readonly logger: Logger
  readonly runner: ProviderRunner
}

interface ResearchSearchExecution {
  readonly input: ResearchSearchInput
  readonly configured: ResolvedSearchProvider
  readonly role: 'default' | 'fallback'
}

export function createWebRetrievalService(
  config: ResolvedConfig,
  logger: Logger
): WebRetrievalService {
  const runner = createProviderRunner(config.webSearch)
  const state = { config, logger, runner }

  return {
    // Research searches never implicitly fall back to DuckDuckGo; general search does. Intentional asymmetry.
    searchDefault: (input) => searchConfigured(input, 'default', state),
    searchFallback: (input) => searchConfigured(input, 'fallback', state),
    retrieveContents: (input) => retrieveContents(input, config, runner),
    fetchDirect: (input) => fetchDirect(input, config, runner),
    searchGeneral: (input) => searchGeneral(input, state),
    fetchGeneral: (input) => {
      assertRetrievalActive(input.signal)
      return fetchGeneralPage(input, GENERAL_WEB_MAX_BYTES)
    },
  }
}

function searchConfigured(
  input: ResearchSearchInput,
  role: 'default' | 'fallback',
  state: WebRetrievalState
): Promise<ResearchSearchOutcome> {
  assertRetrievalActive(input.signal)
  const configured =
    role === 'default' ? defaultSearchProvider(state.config) : state.config.webSearch.fallback

  if (configured === undefined) {
    return Promise.resolve({ kind: 'fallback_unconfigured' })
  }

  return searchResearch({ input, configured, role }, state)
}

async function searchGeneral(
  input: GeneralSearchInput,
  state: WebRetrievalState
): Promise<readonly SearchResult[]> {
  assertRetrievalActive(input.signal)
  const { config, logger, runner } = state
  const configured = defaultSearchProvider(config)
  const first = await runner.search({
    backend: PROVIDERS[configured.provider],
    configured,
    role: 'default',
    request: toSearchRequest(input, config, logger),
    signal: input.signal,
    recordExternalCost: input.recordExternalCost,
    ...(input.cacheScope === undefined ? {} : { cacheScope: input.cacheScope }),
    requestedMaxResults: input.maxResults,
  })

  if (first.kind === 'response' && first.response.results.length > 0) {
    return capSearchResults(first.response.results, config.webSearch.snippetMaxChars)
  }

  const fallback = config.webSearch.fallback ?? IMPLICIT_DUCKDUCKGO

  if (fallback.provider === configured.provider) {
    return first.kind === 'response'
      ? capSearchResults(first.response.results, config.webSearch.snippetMaxChars)
      : Promise.reject(providerFailed())
  }

  logger.warn('web_search.fallback', {
    provider: configured.provider,
    fallback: fallback.provider,
    reason: first.kind === 'failed' ? 'failed' : 'empty',
    ...(first.kind === 'failed' && first.attempt.failureCode !== undefined
      ? { failureCode: first.attempt.failureCode }
      : {}),
  })
  const second = await runner.search({
    backend: PROVIDERS[fallback.provider],
    configured: fallback,
    role: 'fallback',
    request: toSearchRequest(input, config, logger),
    signal: input.signal,
    recordExternalCost: input.recordExternalCost,
    ...(input.cacheScope === undefined ? {} : { cacheScope: input.cacheScope }),
    requestedMaxResults: input.maxResults,
  })

  if (second.kind === 'failed') {
    logger.warn('web_search.providers_failed', {
      provider: configured.provider,
      fallback: fallback.provider,
      ...(second.attempt.failureCode === undefined
        ? {}
        : { failureCode: second.attempt.failureCode }),
    })
    throw providerFailed()
  }

  return capSearchResults(second.response.results, config.webSearch.snippetMaxChars)
}

async function searchResearch(
  execution: ResearchSearchExecution,
  state: WebRetrievalState
): Promise<ResearchSearchOutcome> {
  const { input, configured, role } = execution
  const { config, logger, runner } = state
  const run = await runner.search({
    backend: PROVIDERS[configured.provider],
    configured,
    role,
    request: toSearchRequest(input, config, logger),
    signal: input.signal,
    recordExternalCost: input.recordExternalCost,
    ...(input.cacheScope === undefined ? {} : { cacheScope: input.cacheScope }),
    requestedMaxResults: input.maxResults,
  })

  if (run.kind === 'failed') {
    return { kind: 'failed', attempt: run.attempt }
  }

  if (run.response.results.length === 0) {
    return { kind: 'empty', attempt: run.attempt }
  }

  return {
    kind: 'results',
    results: capSearchResults(run.response.results, config.webSearch.snippetMaxChars).map(
      (result) => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        highlights: result.highlights,
        engines: result.engines,
        ...(result.author === undefined ? {} : { author: result.author }),
        ...(result.publishedOn === undefined ? {} : { publishedOn: result.publishedOn }),
      })
    ),
    attempt: run.attempt,
  }
}

async function retrieveContents(
  input: ResearchContentsInput,
  config: ResolvedConfig,
  runner: ProviderRunner
): Promise<ResearchContentsOutcome> {
  assertRetrievalActive(input.signal)
  const configured =
    input.role === 'default' ? defaultSearchProvider(config) : config.webSearch.fallback

  if (configured?.provider !== 'exa') {
    return { kind: 'provider_unavailable' }
  }

  let urls: readonly string[]

  try {
    urls = normalizeProviderUrls(input.urls)
  } catch {
    return invalidContentsOutcome(configured.provider, input.role)
  }

  if (urls.length === 0 || urls.length > EXA_CONTENTS_URL_MAX) {
    return invalidContentsOutcome(configured.provider, input.role)
  }
  const run = await runner.contents({
    configured,
    role: input.role,
    urls,
    query: input.query,
    signal: input.signal,
    recordExternalCost: input.recordExternalCost,
    ...(input.cacheScope === undefined ? {} : { cacheScope: input.cacheScope }),
    execute: (signal) =>
      exaContents({
        ...(configured.apiKey === undefined ? {} : { apiKey: configured.apiKey }),
        urls,
        query: input.query,
        maxTextCharacters: Math.floor(
          config.research.maxFullTextBytesPerSource / MAX_UTF8_BYTES_PER_CHARACTER
        ),
        maxResponseBytes:
          urls.length * config.research.maxFullTextBytesPerSource + EXA_RESPONSE_METADATA_BYTES,
        excerptMaxCharacters: config.research.maxExcerptChars,
        signal,
      }),
  })

  return run.kind === 'failed'
    ? { kind: 'failed', attempt: run.attempt }
    : {
        kind: 'contents',
        items: run.response.items,
        failures: run.response.failures,
        attempt: run.attempt,
      }
}

async function fetchDirect(
  input: ResearchDirectFetchInput,
  config: ResolvedConfig,
  runner: ProviderRunner
): Promise<ResearchDirectFetchOutcome> {
  assertRetrievalActive(input.signal)
  const startedAt = performance.now()
  let canonicalUrl: string

  try {
    canonicalUrl = canonicalHttpsUrl(input.url)
  } catch {
    return directFetchFailure('', startedAt, 'invalid_request')
  }

  const key =
    input.cacheScope === undefined
      ? undefined
      : JSON.stringify(['direct', input.cacheScope, canonicalUrl])
  const hit = key === undefined ? undefined : runner.readDirect(key)

  if (hit !== undefined) {
    return {
      kind: 'content',
      ...hit,
      attempt: directFetchAttempt(hit.canonicalUrl, 'cache_hit', 0),
    }
  }

  try {
    const content = await fetchDirectPage({
      url: canonicalUrl,
      timeoutMs: config.webSearch.timeoutMs,
      maxReadBytes: DIRECT_FETCH_MAX_READ_BYTES,
      maxBytes: config.research.maxFullTextBytesPerSource,
      publishedDayOf: input.publishedDayOf,
      signal: input.signal,
    })

    if (key !== undefined) {
      runner.writeDirect(key, content)
    }

    return {
      kind: 'content',
      ...content,
      attempt: directFetchAttempt(canonicalUrl, 'success', performance.now() - startedAt),
    }
  } catch (error: unknown) {
    if (input.signal.aborted) {
      throw error
    }

    return directFetchFailure(canonicalUrl, startedAt, directFetchFailureCode(error))
  }
}

function invalidContentsOutcome(
  provider: WebSearchProvider,
  role: 'default' | 'fallback'
): ResearchContentsOutcome {
  return {
    kind: 'failed',
    attempt: {
      transport: 'provider',
      provider,
      role,
      operation: 'contents',
      outcome: 'failed',
      latencyMs: 0,
      costUsd: 0,
      resultCount: 0,
      freshness: 'not_requested',
      failureCode: 'invalid_request',
    },
  }
}

function providerFailed(): ToolError {
  return new ToolError('unexpected', 'web search providers failed')
}

function assertRetrievalActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError(signal)
  }
}
