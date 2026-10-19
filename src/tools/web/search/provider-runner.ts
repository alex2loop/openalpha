import type {
  ResolvedSearchProvider,
  ResolvedWebSearch,
  WebSearchProvider,
} from '@/core/config/resolve'
import type { ExternalCharge } from '@/core/types/usage'
import type { ResearchProviderAttempt, ResearchProviderFailureCode } from '@/engine/api'
import type {
  ExaContentsResponse,
  ProviderContentsRunInput,
  ProviderContentsRunResult,
  ProviderGate,
  ProviderRunner,
  ProviderRunnerState,
  ProviderSearchRunInput,
  ProviderSearchRunResult,
  RetrievalCacheEntry,
  SearchBackendResponse,
  SearchOperation,
} from '@/tools/web/search/types'
import { abortError, RunHalted } from '@/core/errors'
import { ttlCache } from '@/core/utils/collections'
import { withRetry } from '@/core/utils/retry'
import { contentsCacheKey, filterSearchResults, searchCacheKey } from '@/tools/web/search/domains'
import {
  SEARCH_RETRY_AFTER_MAX_MS,
  SearchProviderError,
  SearchRetryableError,
} from '@/tools/web/search/errors'
import { createProviderBreaker } from '@/tools/web/search/provider-breaker'
import { runThrottled } from '@/tools/web/search/provider-throttle'
import { ZERO_PROVIDER_COST_USD } from '@/tools/web/search/types'

const EMPTY_SEARCH_UNBILLED_PROVIDERS: readonly WebSearchProvider[] = ['deepseek']

interface BoundedOperationInput<T> {
  readonly provider: ResolvedSearchProvider['provider']
  readonly callerSignal: AbortSignal
  readonly state: ProviderRunnerState
  readonly operation: (signal: AbortSignal) => Promise<T>
}

interface SearchAttemptInput {
  readonly run: ProviderSearchRunInput
  readonly response: SearchBackendResponse
  readonly outcome: ResearchProviderAttempt['outcome']
  readonly latencyMs: number
  readonly costUsd: number
}

interface ContentsAttemptInput {
  readonly run: ProviderContentsRunInput
  readonly response: ExaContentsResponse
  readonly outcome: ResearchProviderAttempt['outcome']
  readonly latencyMs: number
  readonly costUsd: number
}

interface FailedAttemptInput {
  readonly provider: ResolvedSearchProvider['provider']
  readonly role: 'default' | 'fallback'
  readonly operation: SearchOperation
  readonly startedAt: number
  readonly error: unknown
}

interface ExternalCostRun {
  readonly recordExternalCost: (charge: ExternalCharge) => Promise<void>
  readonly configured: ResolvedSearchProvider
}

export function createProviderRunner(config: ResolvedWebSearch): ProviderRunner {
  const cache =
    config.cacheTtlMs === 0
      ? undefined
      : ttlCache<string, RetrievalCacheEntry>(config.cacheTtlMs, config.cacheMaxEntries)
  const gates = new Map<string, ProviderGate>()
  const breaker = createProviderBreaker({
    threshold: config.breakerThreshold,
    cooldownMs: config.breakerCooldownMs,
  })
  const state = { config, cache, gates, breaker }

  return {
    search: (input) => runSearch(input, state),
    contents: (input) => runContents(input, state),
    readDirect: (key) => {
      const hit = cache?.get(key)
      return hit?.kind === 'direct' ? hit.content : undefined
    },
    writeDirect: (key, content) => cache?.set(key, { kind: 'direct', content }),
  }
}

async function runSearch(
  input: ProviderSearchRunInput,
  state: ProviderRunnerState
): Promise<ProviderSearchRunResult> {
  assertProviderActive(input.signal)
  const key = searchCacheKey(input, state.config.exaSearchType)
  const hit = key === undefined ? undefined : state.cache?.get(key)

  if (hit?.kind === 'search') {
    return cachedSearchResult(input, hit.response)
  }

  const startedAt = performance.now()
  const request = {
    ...input.request,
    signal: input.signal,
    ...(input.configured.apiKey === undefined ? {} : { apiKey: input.configured.apiKey }),
    ...(input.configured.baseUrl === undefined ? {} : { baseUrl: input.configured.baseUrl }),
  }

  try {
    const response = await runBoundedOperation({
      provider: input.configured.provider,
      callerSignal: input.signal,
      state,
      operation: (signal) => input.backend({ ...request, signal }),
    })
    const filtered = {
      ...response,
      results: filterSearchResults(response.results, request, input.requestedMaxResults),
    }
    const billedUsd = resolveBilledCostUsd(input.configured, response)

    await recordBilledCost(input, 'search', billedUsd)

    if (key !== undefined) {
      state.cache?.set(key, { kind: 'search', response: filtered })
    }

    return {
      kind: 'response',
      response: filtered,
      attempt: searchAttempt({
        run: input,
        response: filtered,
        outcome: filtered.results.length === 0 ? 'empty' : 'success',
        latencyMs: elapsedMs(startedAt),
        costUsd: billedUsd,
      }),
    }
  } catch (error: unknown) {
    // Recorded before the rethrow: an abort still owes whatever the provider already billed.
    await recordFailureCost(error, input, 'search')
    rethrowControlFlow(error, input.signal)

    return {
      kind: 'failed',
      attempt: failedAttempt({
        provider: input.configured.provider,
        role: input.role,
        operation: 'search',
        startedAt,
        error,
      }),
    }
  }
}

function cachedSearchResult(
  input: ProviderSearchRunInput,
  response: SearchBackendResponse
): ProviderSearchRunResult {
  return {
    kind: 'response',
    response,
    attempt: searchAttempt({
      run: input,
      response,
      outcome: 'cache_hit',
      latencyMs: 0,
      costUsd: ZERO_PROVIDER_COST_USD,
    }),
  }
}

async function runContents(
  input: ProviderContentsRunInput,
  state: ProviderRunnerState
): Promise<ProviderContentsRunResult> {
  assertProviderActive(input.signal)
  const key = contentsCacheKey(input, state.config.exaSearchType)
  const hit = key === undefined ? undefined : state.cache?.get(key)

  if (hit?.kind === 'contents') {
    return {
      kind: 'response',
      response: hit.response,
      attempt: contentsAttempt({
        run: input,
        response: hit.response,
        outcome: 'cache_hit',
        latencyMs: 0,
        costUsd: ZERO_PROVIDER_COST_USD,
      }),
    }
  }

  const startedAt = performance.now()

  try {
    const response = await runBoundedOperation({
      provider: input.configured.provider,
      callerSignal: input.signal,
      state,
      operation: input.execute,
    })

    await recordBilledCost(input, 'contents', response.costUsd)

    if (key !== undefined) {
      state.cache?.set(key, { kind: 'contents', response })
    }

    const outcome = contentsOutcome(response)
    return {
      kind: 'response',
      response,
      attempt: contentsAttempt({
        run: input,
        response,
        outcome,
        latencyMs: elapsedMs(startedAt),
        costUsd: response.costUsd,
      }),
    }
  } catch (error: unknown) {
    await recordFailureCost(error, input, 'contents')
    rethrowControlFlow(error, input.signal)

    return {
      kind: 'failed',
      attempt: failedAttempt({
        provider: input.configured.provider,
        role: input.role,
        operation: 'contents',
        startedAt,
        error,
      }),
    }
  }
}

async function runBoundedOperation<T>(input: BoundedOperationInput<T>): Promise<T> {
  const { provider, callerSignal, state } = input
  const { gates, breaker } = state
  if (callerSignal.aborted) {
    return Promise.reject(abortError(callerSignal))
  }

  const startedAt = performance.now()
  if (breaker.isOpen(provider, startedAt)) {
    return Promise.reject(
      new SearchProviderError('circuit_open', 'provider is in cooldown after repeated failures')
    )
  }

  const timeoutController = new AbortController()

  try {
    const value = await runThrottled({
      gates,
      provider,
      signal: callerSignal,
      task: () => runWithDeadline(input, timeoutController),
    })

    breaker.recordSuccess(provider)
    return value
  } catch (error: unknown) {
    const resolved =
      timeoutController.signal.aborted && !callerSignal.aborted
        ? new SearchProviderError('timeout', 'provider operation timed out')
        : error

    // The whole operation is one failure however many times withRetry retried inside it, and a
    // caller abort is the caller's decision, so it never counts against the provider.
    if (!callerSignal.aborted) {
      breaker.recordFailure(provider, failureCodeOf(resolved), performance.now())
    }

    throw resolved
  }
}

// The deadline starts once the gate has granted a slot, so time spent queued is never charged to
// the provider.
async function runWithDeadline<T>(
  input: BoundedOperationInput<T>,
  deadline: AbortController
): Promise<T> {
  const { callerSignal, state, operation } = input
  const { config } = state
  const timeout = setTimeout(
    () => deadline.abort(new SearchProviderError('timeout', 'provider operation timed out')),
    config.timeoutMs
  )
  const signal = AbortSignal.any([callerSignal, deadline.signal])

  try {
    return await withRetry(() => operation(signal), {
      maxAttempts: config.retryAttempts,
      initialMs: config.retryInitialMs,
      maxMs: SEARCH_RETRY_AFTER_MAX_MS,
      signal,
      isRetryable: (error) => error instanceof SearchRetryableError,
      delayFor: (error) => (error instanceof SearchRetryableError ? error.retryAfterMs : 0),
    })
  } finally {
    clearTimeout(timeout)
  }
}

function searchAttempt(input: SearchAttemptInput): ResearchProviderAttempt {
  const { run, response, outcome, latencyMs, costUsd } = input
  return {
    transport: 'provider',
    provider: run.configured.provider,
    role: run.role,
    operation: 'search',
    outcome,
    latencyMs,
    costUsd,
    resultCount: response.results.length,
    freshness: response.freshness,
    ...(response.requestId === undefined ? {} : { requestId: response.requestId }),
    ...(response.requestedSearchType === undefined
      ? {}
      : { requestedSearchType: response.requestedSearchType }),
    ...(response.resolvedSearchType === undefined
      ? {}
      : { resolvedSearchType: response.resolvedSearchType }),
  }
}

function contentsAttempt(input: ContentsAttemptInput): ResearchProviderAttempt {
  const { run, response, outcome, latencyMs, costUsd } = input
  return {
    transport: 'provider',
    provider: run.configured.provider,
    role: run.role,
    operation: 'contents',
    outcome,
    latencyMs,
    costUsd,
    resultCount: response.items.length,
    freshness: 'not_requested',
    requestId: response.requestId,
  }
}

function failedAttempt(input: FailedAttemptInput): ResearchProviderAttempt {
  const { provider, role, operation, startedAt, error } = input
  return {
    transport: 'provider',
    provider,
    role,
    operation,
    outcome: 'failed',
    latencyMs: elapsedMs(startedAt),
    costUsd: error instanceof SearchProviderError ? error.costUsd : ZERO_PROVIDER_COST_USD,
    resultCount: 0,
    freshness: 'not_requested',
    failureCode: failureCodeOf(error),
  }
}

function contentsOutcome(response: ExaContentsResponse): ResearchProviderAttempt['outcome'] {
  if (response.failures.length > 0) {
    return 'partial'
  }

  return response.items.length === 0 ? 'empty' : 'success'
}

function failureCodeOf(error: unknown): ResearchProviderFailureCode {
  if (error instanceof SearchProviderError || error instanceof SearchRetryableError) {
    return error.failureCode
  }

  return 'transport'
}

async function recordBilledCost(
  run: ExternalCostRun,
  operation: SearchOperation,
  costUsd: number
): Promise<void> {
  if (costUsd > ZERO_PROVIDER_COST_USD) {
    await run.recordExternalCost({ provider: run.configured.provider, operation, costUsd })
  }
}

// Most providers bill every query; DeepSeek bills only a search that returns results.
function resolveBilledCostUsd(
  configured: ResolvedSearchProvider,
  response: SearchBackendResponse
): number {
  if (response.costUsd > ZERO_PROVIDER_COST_USD) {
    return response.costUsd
  }

  if (
    EMPTY_SEARCH_UNBILLED_PROVIDERS.includes(configured.provider) &&
    response.results.length === 0
  ) {
    return ZERO_PROVIDER_COST_USD
  }

  return configured.costPerSearchUsd ?? ZERO_PROVIDER_COST_USD
}

async function recordFailureCost(
  error: unknown,
  run: ExternalCostRun,
  operation: SearchOperation
): Promise<void> {
  if (error instanceof SearchProviderError) {
    await recordBilledCost(run, operation, error.costUsd)
  }
}

function rethrowControlFlow(error: unknown, signal: AbortSignal): void {
  if (error instanceof RunHalted) {
    throw error
  }

  if (signal.aborted) {
    throw abortError(signal)
  }
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, performance.now() - startedAt)
}

function assertProviderActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError(signal)
  }
}
