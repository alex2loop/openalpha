import { scanOutput } from '@/core/security/sanitize'

import type { ValidationGapReason } from '../evidence/gaps'
import type {
  DateConfidence,
  DateProvenance,
  ResearchFreshness,
  ResearchSourceDiscovery,
} from '../evidence/model'
import type {
  ResearchContentsOutcome,
  ResearchDirectFetchOutcome,
  ResearchProviderAttempt,
  ResearchSearchOutcome,
  ResearchSearchResult,
} from './retrieval'
import type { ResearchRetrievalState } from './state'
import type { GatherContext } from './types'
import { canonicalizeResearchUrl } from '../evidence/citations'
import { extractPublishedDay } from './page-dates'
import { toBoundedQueryExcerpt } from './state'

const HTTP_SCHEME_RE = /^http:\/\//i

export const REQUESTED_DISCOVERY: ResearchSourceDiscovery = { kind: 'direct', origin: 'request' }

type ContentAdmissionStatus = ReturnType<ResearchRetrievalState['storeContent']>[number]

export interface ResearchRetrievedSource {
  readonly url: string
  readonly title: string
  readonly author?: string
  readonly publishedOn?: string
  readonly dateProvenance?: DateProvenance
  readonly dateConfidence?: DateConfidence
  readonly discovery: ResearchSourceDiscovery
  readonly snippet: string
  readonly content?: string
}

interface AdmittedDiscoveryResults {
  readonly results: readonly ResearchSearchResult[]
  readonly attempt: ResearchProviderAttempt
  readonly gaps: readonly {
    readonly code:
      | 'freshness_out_of_window'
      | 'freshness_uncertain'
      | 'unsafe_content'
      | 'validation'
    readonly message: string
    readonly values: readonly string[]
    readonly params?: { readonly reason?: ValidationGapReason }
  }[]
}

interface ResearchActivityOptionsBase<T> {
  readonly detail: string
  readonly run: () => Promise<T>
}

type ResearchActivityOptions<T> =
  | (ResearchActivityOptionsBase<T> & { readonly operation: 'search' })
  | (ResearchActivityOptionsBase<T> & { readonly operation: 'fetch'; readonly pageCount: number })

export type SearchActivityResult =
  | { readonly kind: 'filtered'; readonly filtered: AdmittedDiscoveryResults }
  | {
      readonly kind: 'outcome'
      readonly outcome: Exclude<ResearchSearchOutcome, { readonly kind: 'results' }>
    }

type ContentsActivityResult =
  | {
      readonly kind: 'contents'
      readonly outcome: Extract<ResearchContentsOutcome, { readonly kind: 'contents' }>
      readonly statuses: readonly ContentAdmissionStatus[]
    }
  | {
      readonly kind: 'outcome'
      readonly outcome: Exclude<ResearchContentsOutcome, { readonly kind: 'contents' }>
    }

type DirectActivityResult =
  | {
      readonly kind: 'content'
      readonly outcome: Extract<ResearchDirectFetchOutcome, { readonly kind: 'content' }>
      readonly statuses: readonly ContentAdmissionStatus[]
    }
  | {
      readonly kind: 'failed'
      readonly outcome: Extract<ResearchDirectFetchOutcome, { readonly kind: 'failed' }>
    }

interface RunContentsActivityInput {
  readonly ctx: GatherContext
  readonly requested: readonly ResearchSearchResult[]
  readonly attempt: ResearchProviderAttempt
}

interface RunDirectActivityInput {
  readonly ctx: GatherContext
  readonly result: ResearchSearchResult
}

export async function runSearchActivity(
  ctx: GatherContext,
  run: () => Promise<ResearchSearchOutcome>
): Promise<SearchActivityResult> {
  return withProgressActivity(ctx, {
    operation: 'search',
    detail: ctx.query,
    run: async () => {
      const outcome = await run()

      return outcome.kind === 'results'
        ? {
            kind: 'filtered',
            filtered: admitDiscoveryResults(outcome.results, outcome.attempt, ctx.freshness),
          }
        : { kind: 'outcome', outcome }
    },
  })
}

export async function runContentsActivity(
  input: RunContentsActivityInput
): Promise<ContentsActivityResult> {
  const { ctx, requested, attempt } = input
  const firstRequested = requested[0]

  if (firstRequested === undefined) {
    return { kind: 'outcome', outcome: { kind: 'provider_unavailable' } }
  }

  return withProgressActivity(ctx, {
    operation: 'fetch',
    detail: firstRequested.url,
    pageCount: requested.length,
    run: async () => {
      const outcome = await ctx.retrieval.retrieveContents({
        role: attempt.role,
        urls: requested.map((result) => result.url),
        query: ctx.query,
        signal: ctx.invocation.signal,
        recordExternalCost: ctx.invocation.recordExternalCost,
        ...(ctx.cacheScope === undefined ? {} : { cacheScope: ctx.cacheScope }),
      })

      if (outcome.kind !== 'contents') {
        return { kind: 'outcome', outcome }
      }

      const statuses = ctx.state.storeContent(
        outcome.items.map((item) => ({ url: item.canonicalUrl, text: item.text }))
      )
      return { kind: 'contents', outcome, statuses }
    },
  })
}

export async function runDirectActivity(
  input: RunDirectActivityInput
): Promise<DirectActivityResult> {
  const { ctx, result } = input

  return withProgressActivity(ctx, {
    operation: 'fetch',
    detail: result.url,
    pageCount: 1,
    run: async () => {
      const outcome = await ctx.retrieval.fetchDirect({
        url: result.url,
        publishedDayOf: extractPublishedDay,
        signal: ctx.invocation.signal,
        recordExternalCost: ctx.invocation.recordExternalCost,
        ...(ctx.cacheScope === undefined ? {} : { cacheScope: ctx.cacheScope }),
      })

      if (outcome.kind === 'failed') {
        return { kind: 'failed', outcome }
      }

      const statuses = ctx.state.storeContent([
        {
          url: outcome.canonicalUrl,
          text: outcome.text,
          ...(outcome.publishedDay === undefined ? {} : { publishedDay: outcome.publishedDay }),
        },
      ])
      return { kind: 'content', outcome, statuses }
    },
  })
}

// The question line shows the operation as it starts; there is no completion event to pair with.
async function withProgressActivity<T>(
  ctx: GatherContext,
  options: ResearchActivityOptions<T>
): Promise<T> {
  ctx.reportOperation?.({
    operation: options.operation,
    detail: options.detail,
    ...(options.operation === 'fetch' ? { pageCount: options.pageCount } : {}),
  })
  return options.run()
}

export function sourcesWithCachedContent(
  ctx: GatherContext,
  results: readonly ResearchSearchResult[],
  attempt: ResearchProviderAttempt | undefined
): readonly ResearchRetrievedSource[] {
  return toResearchRetrievedSources(results, attempt).flatMap((source) => {
    const content = ctx.state.getContent(source.url)

    return content === undefined
      ? []
      : [
          withExtractedDate(
            {
              ...source,
              content: toBoundedQueryExcerpt(content, ctx.query, ctx.config.maxExcerptChars),
            },
            ctx.state.getPublishedDay(source.url)
          ),
        ]
  })
}

export function sourcesWithOptionalCachedContent(
  ctx: GatherContext,
  results: readonly ResearchSearchResult[],
  attempt: ResearchProviderAttempt | undefined
): readonly ResearchRetrievedSource[] {
  return toResearchRetrievedSources(results, attempt).map((source) => {
    const content = ctx.state.getContent(source.url)

    return content === undefined
      ? source
      : withExtractedDate(
          {
            ...source,
            content: toBoundedQueryExcerpt(content, ctx.query, ctx.config.maxExcerptChars),
          },
          ctx.state.getPublishedDay(source.url)
        )
  })
}

export function mergeSources(
  first: readonly ResearchRetrievedSource[],
  second: readonly ResearchRetrievedSource[],
  maxResults: number
): readonly ResearchRetrievedSource[] {
  const merged = new Map<string, ResearchRetrievedSource>()
  for (const source of [...first, ...second]) {
    // Admission re-keys this list canonically; merging on the raw url would put one page in the
    // prompt twice, and quotes from the entry admission drops then fail containment.
    merged.set(canonicalizeResearchUrl(source.url) ?? source.url, source)
  }
  return [...merged.values()].slice(0, maxResults)
}

// The provider estimate and the page's own markup are independent signals; agreement is the
// verification step the provider date alone lacks. Disagreement is uncertainty, not a winner —
// low confidence keeps the source admitted with a penalty instead of hard-rejecting on either.
function withExtractedDate(
  source: ResearchRetrievedSource,
  extractedDay: string | undefined
): ResearchRetrievedSource {
  if (extractedDay === undefined) {
    return source
  }
  return {
    ...source,
    publishedOn: extractedDay,
    dateProvenance: 'extracted_text',
    dateConfidence: extractedDateConfidence(source.publishedOn, extractedDay),
  }
}

function extractedDateConfidence(
  providerDay: string | undefined,
  extractedDay: string
): DateConfidence {
  if (providerDay === undefined) {
    return 'medium'
  }
  return providerDay === extractedDay ? 'high' : 'low'
}

function isWithinResearchFreshness(day: string, freshness: ResearchFreshness): boolean {
  if (freshness.fromOn !== undefined && day < freshness.fromOn) {
    return false
  }
  return freshness.toOn === undefined || day <= freshness.toOn
}

// Indexes keep plain-http links to pages their hosts also serve over https (VN brokers' report
// PDFs among them). The https address is the one read and cited; a host without it fails that
// read as a gap like any other unreachable page.
function upgradeToHttps(raw: string): string {
  return raw.trim().replace(HTTP_SCHEME_RE, 'https://')
}

export function admitDiscoveryResults(
  results: readonly ResearchSearchResult[],
  attempt: ResearchProviderAttempt,
  freshness?: ResearchFreshness
): AdmittedDiscoveryResults {
  const resolvedAttempt: ResearchProviderAttempt =
    freshness === undefined || attempt.freshness === 'pushed_down'
      ? attempt
      : { ...attempt, freshness: 'post_filtered' }
  const admitted: ResearchSearchResult[] = []
  const gaps: AdmittedDiscoveryResults['gaps'][number][] = []

  for (const found of results) {
    if (!isSafeDiscoveryResult(found)) {
      gaps.push({
        code: 'unsafe_content',
        message: 'provider discovery material failed prompt-injection scan',
        values: [found.url],
      })
      continue
    }

    const result = { ...found, url: upgradeToHttps(found.url) }

    // A non-https url has no canonical form, so nothing downstream can cite it. Left in, it reaches
    // the model and its quotes return as claims rejected for citing a page that was never fetched.
    if (canonicalizeResearchUrl(result.url) === undefined) {
      gaps.push({
        code: 'validation',
        message: 'source url is not a canonical https url',
        values: [result.url],
        params: { reason: 'source_url_not_canonical' },
      })
      continue
    }
    annotateFreshness({ result, freshness, admitted, gaps })
  }
  return { results: admitted, attempt: resolvedAttempt, gaps }
}

// Without a search attempt the page is one the request itself named, not one a provider found.
function toResearchRetrievedSources(
  results: readonly ResearchSearchResult[],
  attempt: ResearchProviderAttempt | undefined
): readonly ResearchRetrievedSource[] {
  return results.map((result, index) => ({
    url: result.url,
    title: result.title,
    snippet: result.snippet,
    discovery:
      attempt === undefined ? REQUESTED_DISCOVERY : toProviderDiscovery(attempt, result, index),
    ...(result.author === undefined ? {} : { author: result.author }),
    ...(result.publishedOn === undefined ? {} : providerDate(result.publishedOn)),
  }))
}

function toProviderDiscovery(
  attempt: ResearchProviderAttempt,
  result: ResearchSearchResult,
  resultIndex: number
): ResearchSourceDiscovery {
  return {
    kind: 'provider',
    provider: attempt.provider,
    role: attempt.role,
    resultIndex,
    highlights: [...result.highlights],
    engines: [...result.engines],
    ...(attempt.requestId === undefined ? {} : { requestId: attempt.requestId }),
    ...(attempt.requestedSearchType === undefined
      ? {}
      : { requestedSearchType: attempt.requestedSearchType }),
    ...(attempt.resolvedSearchType === undefined
      ? {}
      : { resolvedSearchType: attempt.resolvedSearchType }),
  }
}

function isSafeDiscoveryResult(result: ResearchSearchResult): boolean {
  const material = [
    result.title,
    ...(result.author === undefined ? [] : [result.author]),
    result.snippet,
    ...result.highlights.map((highlight) => highlight.text),
  ].join('\n')
  return scanOutput(material).length === 0
}

interface AnnotateFreshnessInput {
  readonly result: ResearchSearchResult
  readonly freshness: ResearchFreshness | undefined
  readonly admitted: ResearchSearchResult[]
  readonly gaps: AdmittedDiscoveryResults['gaps'][number][]
}

// Annotates, never excludes: a freshness constraint records a gap and keeps the result.
function annotateFreshness(input: AnnotateFreshnessInput): void {
  const { result, freshness, admitted, gaps } = input

  admitted.push(result)
  if (freshness === undefined) {
    return
  }
  if (result.publishedOn === undefined || freshness.field === 'updatedOn') {
    gaps.push({
      code: 'freshness_uncertain',
      message: 'source date could not be verified for the requested freshness field',
      values: [result.url, freshness.field],
    })
    return
  }
  if (!isWithinResearchFreshness(result.publishedOn, freshness)) {
    gaps.push({
      code: 'freshness_out_of_window',
      message: 'source date falls outside the requested freshness window',
      values: [result.url, result.publishedOn],
    })
  }
}

function providerDate(
  publishedOn: string
): Pick<ResearchRetrievedSource, 'publishedOn' | 'dateProvenance' | 'dateConfidence'> {
  return { publishedOn, dateProvenance: 'provider_estimate', dateConfidence: 'medium' }
}
