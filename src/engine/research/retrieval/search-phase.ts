import type { GatherNeed } from '../contracts'
import type { ValidationGapReason } from '../evidence/gaps'
import type { ResearchRetrievalAttempt } from '../evidence/model'
import type { SearchActivityResult } from './material'
import type {
  ResearchProviderAttempt,
  ResearchProviderFailureCode,
  ResearchSearchInput,
  ResearchSearchOutcome,
  ResearchSearchResult,
} from './retrieval'
import type { GatherContext, GatherGap } from './types'
import { extractQueryEntities } from '../query-entities'
import { runSearchActivity } from './material'
import { rankSearchResults } from './ranking'

export const MAX_GATHERED_SOURCES = 8
// Below this a question reached synthesis on almost nothing; the run should say so rather than
// present a thin answer as a complete one.
const MIN_RECALLED_SOURCES = 2

interface InitialSearches {
  readonly results: readonly ResearchSearchResult[]
  readonly attempt?: ResearchProviderAttempt
  readonly need: GatherNeed
}

/**
 * The discovery half of a gather: claims the question's terms, searches them together, then pools
 * and ranks what came back. Every provider call carries its own timeout, so running the terms
 * concurrently bounds the question at roughly one timeout without a deadline of its own.
 */
export async function runInitialSearches(ctx: GatherContext): Promise<InitialSearches> {
  const queries = claimQueries(ctx)

  if (queries.length === 0 || ctx.invocation.signal.aborted) {
    return { results: [], need: { kind: 'coverage_gap', claimIds: [] } }
  }

  const perQueryResults = Math.max(1, Math.ceil(MAX_GATHERED_SOURCES / queries.length))
  const settled = await Promise.allSettled(
    queries.map((query) =>
      runSearchActivity({ ...ctx, query }, () =>
        ctx.retrieval.searchDefault(searchInput(ctx, query, perQueryResults))
      )
    )
  )

  return collectSearches(ctx, settledActivities(settled))
}

// The ledger is check-then-act, so every term is claimed synchronously before any search starts;
// claiming inside the concurrent pass would let two terms pass the duplicate check on one slot.
function claimQueries(ctx: GatherContext): readonly string[] {
  const claimed: string[] = []

  for (const query of distinctQueries(ctx)) {
    const availability = ctx.state.classifySubquery(query)

    if (availability === 'duplicate') {
      ctx.gaps.push(validationGatherGap('duplicate_subquery', query))
      continue
    }
    if (availability === 'bound') {
      ctx.gaps.push({
        code: 'content_limit',
        message: 'research subquery capacity was reached',
        values: [query],
      })
      break
    }

    ctx.state.rememberSubquery(query)
    claimed.push(query)
  }

  return claimed
}

// runSearchActivity resolves for every provider outcome, so a rejection here is a halt or an abort.
// Every search has recorded its charge by the time this runs; the halt is rethrown only now so the
// accounting is exact, which Promise.all would have skipped by rejecting on the first one.
function settledActivities(
  settled: readonly PromiseSettledResult<SearchActivityResult>[]
): readonly SearchActivityResult[] {
  const activities: SearchActivityResult[] = []
  let halt: unknown

  for (const entry of settled) {
    if (entry.status === 'fulfilled') {
      activities.push(entry.value)
    } else {
      halt ??= entry.reason
    }
  }

  if (halt !== undefined) {
    throw halt
  }

  return activities
}

function collectSearches(
  ctx: GatherContext,
  activities: readonly SearchActivityResult[]
): InitialSearches {
  const pooled: ResearchSearchResult[] = []
  const seen = new Set<string>()
  let attempt: ResearchProviderAttempt | undefined
  let failureCode: ResearchProviderFailureCode | undefined

  for (const activity of activities) {
    if (activity.kind === 'outcome') {
      recordSearchOutcome(ctx, activity.outcome)
      addSearchOutcomeGap(ctx, activity.outcome)
      if (activity.outcome.kind === 'failed') {
        failureCode ??= activity.outcome.attempt.failureCode ?? 'transport'
      }
      continue
    }

    ctx.gaps.push(...activity.filtered.gaps)
    recordAttempt(ctx, activity.filtered.attempt)
    attempt ??= activity.filtered.attempt

    for (const result of activity.filtered.results) {
      if (!seen.has(result.url)) {
        seen.add(result.url)
        pooled.push(result)
      }
    }
  }

  // Concurrent terms have no last outcome, so the need turns on whether anything succeeded at all.
  const need: GatherNeed =
    attempt === undefined && failureCode !== undefined
      ? { kind: 'default_provider_failure', code: failureCode }
      : { kind: 'coverage_gap', claimIds: [] }

  return {
    results: selectBestResults(ctx, pooled),
    ...(attempt === undefined ? {} : { attempt }),
    need,
  }
}

function selectBestResults(
  ctx: GatherContext,
  pooled: readonly ResearchSearchResult[]
): readonly ResearchSearchResult[] {
  const ranked = rankSearchResults({
    results: pooled,
    entities: extractQueryEntities((ctx.queries ?? [ctx.query]).join('\n')),
    now: ctx.now,
    applyStaleness: ctx.freshness !== undefined,
  })

  // Only when a question found something but almost nothing: an empty pool already produced a
  // provider or content gap, and a second one would read as two failures.
  if (ranked.length > 0 && ranked.length < MIN_RECALLED_SOURCES) {
    ctx.gaps.push(validationGatherGap('low_recall', ctx.query))
  }

  return ranked.slice(0, MAX_GATHERED_SOURCES)
}

function addSearchOutcomeGap(
  ctx: GatherContext,
  outcome: Exclude<ResearchSearchOutcome, { readonly kind: 'results' }>
): void {
  if (outcome.kind !== 'failed') {
    return
  }

  pushProviderGap(ctx, 'a planned research subquery could not be retrieved', [
    outcome.attempt.failureCode ?? 'unknown',
  ])
}

function distinctQueries(ctx: GatherContext): readonly string[] {
  const queries: string[] = []
  const seen = new Set<string>()
  const limit = ctx.maxQueries ?? 1

  for (const candidate of ctx.queries ?? [ctx.query]) {
    const query = candidate.trim()
    const key = query.toLowerCase()

    if (query !== '' && !seen.has(key)) {
      seen.add(key)
      queries.push(query)
    }
    if (queries.length >= limit) {
      break
    }
  }

  return queries.length === 0 ? [ctx.query] : queries
}

// Reservations settle in the retrieval state; provider code owns no byte accounting here.

export function searchInput(
  ctx: GatherContext,
  query: string,
  maxResults: number
): ResearchSearchInput {
  return {
    query,
    maxResults,
    locale: ctx.locale,
    signal: ctx.invocation.signal,
    recordExternalCost: ctx.invocation.recordExternalCost,
    ...(ctx.freshness === undefined ? {} : { freshness: ctx.freshness }),
    ...(ctx.cacheScope === undefined ? {} : { cacheScope: ctx.cacheScope }),
  }
}

export function pushProviderGap(
  ctx: GatherContext,
  message: string,
  values: readonly string[]
): void {
  ctx.gaps.push({ code: 'provider_unavailable', message, values })
}

export function validationGatherGap(reason: ValidationGapReason, value: string): GatherGap {
  return { code: 'validation', message: reason, values: [value], params: { reason } }
}

export function recordSearchOutcome(ctx: GatherContext, outcome: ResearchSearchOutcome): void {
  if (outcome.kind !== 'fallback_unconfigured') {
    recordAttempt(ctx, outcome.attempt)
  }
}

export function recordAttempt(ctx: GatherContext, attempt: ResearchRetrievalAttempt): void {
  ctx.attempts.push(attempt)
  ctx.observeAttempt?.(attempt)
}
