import type { GatherNeed } from '../contracts'
import type { ResearchRetrievalAttempt } from '../evidence/model'
import type { ResearchRetrievedSource } from './material'
import type {
  ResearchContentsOutcome,
  ResearchProviderAttempt,
  ResearchSearchResult,
} from './retrieval'
import type { GatherContext, GatherGap, GatherInput, GatherResult } from './types'
import {
  mergeSources,
  REQUESTED_DISCOVERY,
  runContentsActivity,
  runDirectActivity,
  runSearchActivity,
  sourcesWithCachedContent,
  sourcesWithOptionalCachedContent,
} from './material'
import {
  MAX_GATHERED_SOURCES,
  pushProviderGap,
  recordAttempt,
  recordSearchOutcome,
  runInitialSearches,
  searchInput,
  validationGatherGap,
} from './search-phase'
import { explicitResearchUrl, selectSearchResultsBySourceId, syntheticSearchResult } from './state'

// Nothing upstream narrows the sources for a first crawl, so every question defaults to reading
// what its search found; a query naming an https:// page resolves to that page instead.
const READ_DISCOVERED: Extract<GatherNeed, { readonly kind: 'full_content' }> = {
  kind: 'full_content',
  sourceIds: [],
}

interface DirectActionInput {
  readonly ctx: GatherContext
  /** The pages to read, together. */
  readonly results: readonly ResearchSearchResult[]
  readonly allResults: readonly ResearchSearchResult[]
  readonly attempt: ResearchProviderAttempt | undefined
  readonly origin?: 'request'
}

interface FullContentActionInput {
  readonly ctx: GatherContext
  readonly results: readonly ResearchSearchResult[]
  readonly attempt: ResearchProviderAttempt
  readonly need: Extract<GatherNeed, { readonly kind: 'full_content' }>
}

interface ContentsActionInput {
  readonly ctx: GatherContext
  readonly unresolved: readonly ResearchSearchResult[]
  readonly allResults: readonly ResearchSearchResult[]
  readonly attempt: ResearchProviderAttempt
}

export async function gatherSources(input: GatherInput): Promise<GatherResult> {
  const attempts: ResearchRetrievalAttempt[] = []
  const gaps: GatherGap[] = []
  const cacheScope = input.invocation.parent?.runId
  const ctx = {
    ...input,
    attempts,
    gaps,
    ...(cacheScope === undefined ? {} : { cacheScope }),
  }

  const initial = await runInitialSearches(ctx)
  if (initial.attempt === undefined || initial.results.length === 0) {
    return (await readNamedUrl(ctx, initial.attempt)) ?? runFallback(ctx, initial.need)
  }

  const need = ctx.need ?? READ_DISCOVERED
  return runOneNextAction({ ...ctx, need }, initial.results, initial.attempt)
}

// A URL the query names is read even when the search found nothing; a failed read falls through
// to the fallback search instead of reporting a contentless source.
async function readNamedUrl(
  ctx: GatherContext,
  attempt: ResearchProviderAttempt | undefined
): Promise<GatherResult | undefined> {
  const namedUrl = explicitResearchUrl(ctx.query)

  if (namedUrl === undefined) {
    return undefined
  }

  const gathered = await runNamedDirect(ctx, syntheticSearchResult(namedUrl), attempt)

  return gathered.sources.some((source) => source.content !== undefined) ? gathered : undefined
}

function runNamedDirect(
  ctx: GatherContext,
  result: ResearchSearchResult,
  attempt: ResearchProviderAttempt | undefined
): Promise<GatherResult> {
  return runDirect({ ctx, results: [result], allResults: [result], attempt, origin: 'request' })
}

function runOneNextAction(
  ctx: GatherContext & { readonly need: GatherNeed },
  results: readonly ResearchSearchResult[],
  attempt: ResearchProviderAttempt
): Promise<GatherResult> {
  const { need } = ctx

  switch (need.kind) {
    case 'default_provider_failure':
    case 'coverage_gap':
    case 'conflict':
      return runFallback(ctx, need, sourcesWithOptionalCachedContent(ctx, results, attempt))
    case 'full_content':
      return runFullContentAction({ ctx, results, attempt, need })
  }
}

async function runFullContentAction(input: FullContentActionInput): Promise<GatherResult> {
  const { ctx, results, attempt, need } = input
  const selected =
    need.sourceIds.length === 0
      ? results
      : selectSearchResultsBySourceId(results, need.sourceIds, ctx.sourceBindings ?? [])
  const namedUrl = explicitResearchUrl(ctx.query)

  if (namedUrl !== undefined) {
    const namedResult =
      results.find((result) => result.url === namedUrl) ?? syntheticSearchResult(namedUrl)
    return runNamedDirect(ctx, namedResult, attempt)
  }

  if (selected.length === 0) {
    ctx.gaps.push(validationGatherGap('unresolved_full_content', need.sourceIds.join(', ')))
    return gatherResult(ctx, [])
  }

  const unresolved = selected.filter((result) => ctx.state.getContent(result.url) === undefined)

  if (attempt.provider === 'exa') {
    return runContents({ ctx, unresolved, allResults: selected, attempt })
  }

  if (unresolved.length === 0) {
    return discoveredResult(ctx, selected, attempt)
  }

  const pageLimit = ctx.config.maxDirectPagesPerQuestion

  if (unresolved.length > pageLimit) {
    ctx.gaps.push({
      code: 'content_limit',
      message: 'one direct-source action could not read every named source',
      values: unresolved.slice(pageLimit).map((result) => result.url),
    })
  }

  return runDirect({ ctx, results: unresolved.slice(0, pageLimit), allResults: selected, attempt })
}

async function runFallback(
  ctx: GatherContext,
  need: GatherNeed,
  initialSources: readonly ResearchRetrievedSource[] = []
): Promise<GatherResult> {
  const fallback = await runSearchActivity(ctx, () =>
    ctx.retrieval.searchFallback(searchInput(ctx, ctx.query, MAX_GATHERED_SOURCES))
  )

  if (fallback.kind === 'outcome' && fallback.outcome.kind === 'fallback_unconfigured') {
    pushProviderGap(ctx, `configured fallback is unavailable for ${need.kind}`, [need.kind])
    return gatherResult({ ...ctx, need }, initialSources)
  }

  if (fallback.kind === 'outcome') {
    recordSearchOutcome(ctx, fallback.outcome)
    pushProviderGap(ctx, `configured fallback did not satisfy ${need.kind}`, [need.kind])
    return gatherResult({ ...ctx, need }, initialSources)
  }

  const filtered = fallback.filtered
  ctx.gaps.push(...filtered.gaps)
  recordAttempt(ctx, filtered.attempt)
  const reused = sourcesWithCachedContent(ctx, filtered.results, filtered.attempt)
  if (reused.length > 0) {
    return gatherResult(
      { ...ctx, need },
      mergeSources(initialSources, reused, MAX_GATHERED_SOURCES)
    )
  }

  // Snippets are never evidence, so fallback discovery feeds the same one bounded content
  // action as default discovery instead of stopping at URLs.
  const fetched = await runFullContentAction({
    ctx: { ...ctx, need },
    results: filtered.results,
    attempt: filtered.attempt,
    need: READ_DISCOVERED,
  })
  return {
    ...fetched,
    sources: mergeSources(initialSources, fetched.sources, MAX_GATHERED_SOURCES),
  }
}

async function runContents(input: ContentsActionInput): Promise<GatherResult> {
  const { ctx, unresolved, allResults, attempt } = input
  if (unresolved.length === 0) {
    return gatherResult(ctx, sourcesWithCachedContent(ctx, allResults, attempt))
  }

  const activity = await runContentsActivity({ ctx, requested: unresolved, attempt })

  if (activity.kind === 'outcome') {
    return contentsFailureResult(ctx, activity.outcome, { allResults, attempt })
  }

  const { outcome } = activity
  recordAttempt(ctx, outcome.attempt)
  pushContentsFailures(ctx, outcome.failures)

  return gatherResult(ctx, sourcesWithCachedContent(ctx, allResults, attempt))
}

function pushContentsFailures(
  ctx: GatherContext,
  failures: Extract<ResearchContentsOutcome, { readonly kind: 'contents' }>['failures']
): void {
  for (const failure of failures) {
    pushProviderGap(ctx, 'configured Contents retrieval could not read a source', [
      failure.canonicalUrl,
      failure.errorTag,
    ])
  }
}

interface ContentsFailureInput {
  readonly allResults: ContentsActionInput['allResults']
  readonly attempt: ContentsActionInput['attempt']
}

function contentsFailureResult(
  ctx: GatherContext,
  outcome: Exclude<ResearchContentsOutcome, { readonly kind: 'contents' }>,
  input: ContentsFailureInput
): GatherResult {
  if (outcome.kind === 'provider_unavailable') {
    pushProviderGap(ctx, 'selected provider role does not support Contents retrieval', [
      input.attempt.provider,
      input.attempt.role,
    ])
    return discoveredResult(ctx, input.allResults, input.attempt)
  }

  recordAttempt(ctx, outcome.attempt)
  ctx.gaps.push({
    code:
      outcome.attempt.failureCode === 'content_limit' ? 'content_limit' : 'provider_unavailable',
    message: 'configured Contents retrieval failed',
    values: [outcome.attempt.failureCode ?? 'unknown'],
  })
  return discoveredResult(ctx, input.allResults, input.attempt)
}

/** Every page is read at once: one action, however many pages, so a question still costs about one
 *  fetch timeout. A page that fails leaves a gap; only when none could be read does the question
 *  fall back to what the search discovered. */
async function runDirect(input: DirectActionInput): Promise<GatherResult> {
  const { ctx, attempt } = input
  const canonical = await readDirectPages(ctx, input.results)

  if (canonical.size === 0) {
    return discoveredResult(ctx, input.allResults, attempt)
  }

  const allResults = input.allResults.map((item) => {
    const url = canonical.get(item.url)

    return url === undefined || url === item.url ? item : { ...item, url }
  })
  const sources = sourcesWithCachedContent(ctx, allResults, attempt).map(
    (source): ResearchRetrievedSource =>
      input.origin === undefined ? source : { ...source, discovery: REQUESTED_DISCOVERY }
  )

  return gatherResult(ctx, sources)
}

/** The canonical URL of every page that was read, keyed by the URL it was requested under. */
async function readDirectPages(
  ctx: GatherContext,
  results: readonly ResearchSearchResult[]
): Promise<ReadonlyMap<string, string>> {
  const activities = await Promise.all(results.map((result) => runDirectActivity({ ctx, result })))
  const canonical = new Map<string, string>()

  for (const [index, activity] of activities.entries()) {
    recordAttempt(ctx, activity.outcome.attempt)

    const requested = results[index]?.url

    if (activity.kind === 'failed') {
      pushDirectFailure(ctx, activity.outcome.attempt)
    } else if (requested !== undefined) {
      canonical.set(requested, activity.outcome.canonicalUrl)
    }
  }

  return canonical
}

function pushDirectFailure(
  ctx: GatherContext,
  failed: { readonly canonicalUrl: string; readonly failureCode?: string }
): void {
  ctx.gaps.push({
    code: failed.failureCode === 'content_limit' ? 'content_limit' : 'provider_unavailable',
    message: 'guarded direct-source retrieval failed',
    values: [failed.canonicalUrl, failed.failureCode ?? 'unknown'],
  })
}

// Everything the search discovered, carrying page text wherever a read succeeded. A failed read
// returns this rather than content-only sources: the gap already says the text is missing, and
// dropping the source too would report a question that nothing was found for.
function discoveredResult(
  ctx: GatherContext,
  results: readonly ResearchSearchResult[],
  attempt: ResearchProviderAttempt | undefined
): GatherResult {
  return gatherResult(ctx, sourcesWithOptionalCachedContent(ctx, results, attempt))
}

function gatherResult(
  ctx: GatherContext,
  sources: readonly ResearchRetrievedSource[]
): GatherResult {
  return {
    sources,
    gaps: ctx.gaps,
    attempts: ctx.attempts,
    ...(ctx.need === undefined ? {} : { need: ctx.need }),
  }
}
