import type { Logger } from '@/core/logging/logger'
import type { CaveatCode } from '@/trading/kernel/caveat'
import type { SourceHealthLog } from '@/trading/sources/transport/health'
import type { Pacer } from '@/trading/sources/transport/pacer'
import type {
  EndpointMaps,
  PreparedRequest,
  RequestTarget,
} from '@/trading/sources/transport/request-target'
import type {
  PagedSourceRequest,
  SourceFacts,
  SourceFetchOutcome,
  SourceHttp,
  SourceRequest,
} from '@/trading/sources/types'
import { abortError } from '@/core/errors'
import { HttpRequestError, httpRequestWithSignal, parseRetryAfterMs } from '@/core/http-client'
import { formatErrForLog } from '@/core/security/credentials'
import { withRetry } from '@/core/utils/retry'
import { admitRequest } from '@/trading/sources/transport/admission'
import { createSourceHealthLog } from '@/trading/sources/transport/health'
import {
  createFailureReporter,
  type FailureReporter,
  isRetryable,
  toCaveatCode,
} from '@/trading/sources/transport/http-failure'
import { createPacer } from '@/trading/sources/transport/pacer'
import {
  buildEndpointMaps,
  prepareOutbound,
  resolveTarget,
} from '@/trading/sources/transport/request-target'

// Follow-up pages one fetch will chase. Hitting it yields a `source.truncated` caveat rather than
// an unbounded loop against one provider.
const MAXIMUM_PAGES = 20
// The whole page set. Each page still carries its own REQUEST_BUDGET_MS inside this, so without it
// a twenty-page read is twenty budgets in series with nothing over them.
const PAGE_SET_BUDGET_MS = 120_000

// Network tuning, not operator judgment: a provider either answers inside these bounds or the
// failover order moves on. The budget governs pacing, every attempt, and every retry sleep; each
// attempt carries its own deadline inside it, so one slow reply costs an attempt, not the request.
const ATTEMPT_TIMEOUT_MS = 10_000
const REQUEST_BUDGET_MS = 35_000
const MAXIMUM_RESPONSE_BYTES = 2_097_152
const BREAKER_COOLDOWN_MS = 300_000
// Consecutive failures before the breaker opens. Above one because a universe-wide sweep is
// hundreds of requests against one provider, and a single slow reply among them says nothing
// about its health. A provider that sends Retry-After is obeyed on the first response instead.
const BREAKER_FAILURE_THRESHOLD = 3
// How many recent outcomes the rate is measured over, and the share of them that must have failed.
// The streak catches a provider that stopped answering; this catches one that answers half the
// time, where a fan-out's successes reset the streak forever and every failure still pays its full
// retry budget.
const BREAKER_FAILURE_WINDOW = 20
const BREAKER_FAILURE_RATE = 0.5
const RETRY_MAXIMUM_ATTEMPTS = 3
const RETRY_INITIAL_DELAY_MS = 500
const RETRY_MAXIMUM_DELAY_MS = 5_000
const JSON_CONTENT_TYPE = 'application/json'

/** The quote SLA: a dead primary costs at most one attempt before failover moves on. Spread into
 *  the request by every quote adapter so the numbers cannot drift apart.
 *
 *  The budget is wall clock, and a quote read inside a brief shares the process with a hundred
 *  other requests: yahoo answers a lone quote in about a second and took 2.2s to 5.3s during one,
 *  so 3s reported a live provider dead on every run. Widened to cover what was measured rather than
 *  what an idle process manages. */
export const QUOTE_ATTEMPT_LIMITS = Object.freeze({
  attemptTimeoutMs: 8_000,
  maxAttempts: 1,
})

/** The complementary SLA: `resolveAll` waits on every leg, so a retry here is paid by every other
 *  provider in the merge rather than by the one that is failing. One attempt bounds the merge at
 *  its slowest leg's single deadline, and a leg that drops lowers driver coverage, which the
 *  reading already reports. */
export const COMPLEMENTARY_ATTEMPT_LIMITS = Object.freeze({ maxAttempts: 1 })

interface SourceHttpState {
  readonly facts: SourceFacts
  readonly endpoints: EndpointMaps
  readonly health: SourceHealthLog
  readonly pacer: Pacer
  readonly now: () => number
  readonly logger: Logger
  readonly failures: FailureReporter
}

export function createSourceHttp(
  facts: SourceFacts,
  now: () => number,
  logger: Logger
): SourceHttp {
  // Fixed cardinality — one entry per known provider — so neither tracker needs eviction.
  const state: SourceHttpState = {
    facts,
    endpoints: buildEndpointMaps(facts.endpoints),
    health: createSourceHealthLog({
      cooldownMs: BREAKER_COOLDOWN_MS,
      failureThreshold: BREAKER_FAILURE_THRESHOLD,
      failureWindow: BREAKER_FAILURE_WINDOW,
      failureRate: BREAKER_FAILURE_RATE,
      logger,
    }),
    pacer: createPacer(facts.rateLimits),
    now,
    logger,
    failures: createFailureReporter(logger),
  }

  return {
    summary: (id) => state.health.summary(id),
    getText: (request) => run(state, request, (text) => text),
    getJson: (request, parse) =>
      run(state, request, (text, fetchedAt) => parse(JSON.parse(text), fetchedAt)),
    postJson: (request, parse) =>
      run(state, request, (text, fetchedAt) => parse(JSON.parse(text), fetchedAt)),
    getJsonPages: (request, extractRows) => runPaged(state, request, extractRows),
  }
}

async function runPaged<TRow>(
  state: SourceHttpState,
  request: PagedSourceRequest,
  extractRows: (raw: unknown) => readonly TRow[]
): Promise<SourceFetchOutcome<readonly TRow[]>> {
  const pageParam = request.pageParam ?? 'page'
  const deadlineTick = performance.now() + PAGE_SET_BUDGET_MS
  const rows: TRow[] = []
  let fetchedAt = 0
  let page = 0

  while (page < MAXIMUM_PAGES) {
    page += 1

    const outcome = await run(
      state,
      { ...request, query: { ...request.query, [pageParam]: String(page) } },
      (text) => extractRows(JSON.parse(text))
    )

    if (outcome.kind === 'error') {
      // A partial page set is not a value the caller can trust, so this stays an error.
      return outcome
    }

    rows.push(...outcome.value)
    fetchedAt = outcome.fetchedAt

    if (outcome.value.length < request.pageSize) {
      return { kind: 'ok', value: rows, fetchedAt }
    }

    if (performance.now() >= deadlineTick) {
      break
    }
  }

  // Every page came back full, or the set ran out of time. The caller is told it is cut short
  // rather than handed a silent prefix, and the log says which limit stopped it, because the
  // caveat can only carry that it happened.
  state.logger.warn('trading.source_pages_capped', {
    sourceId: request.sourceId,
    path: request.path,
    pages: page,
    limit: page < MAXIMUM_PAGES ? 'deadline' : 'pages',
  })

  return { kind: 'ok', value: rows, fetchedAt, truncated: true }
}

/** Every provider round trip, timed. The screen fans out over a hundred of these across four
 *  providers, and without a per-request elapsed there is no way to tell a slow host from a paced
 *  one. Monotonic clock: `now` is wall time and an NTP step would report a negative duration. */
async function run<T>(
  state: SourceHttpState,
  request: SourceRequest,
  map: (text: string, fetchedAt: number) => T
): Promise<SourceFetchOutcome<T>> {
  const startedTick = performance.now()

  try {
    const sent = await sendRequest(state, request, map)

    logRequest(state.logger, {
      request,
      startedTick,
      ...(sent.sentTick === undefined ? {} : { sentTick: sent.sentTick }),
      status: sent.outcome.kind === 'error' ? sent.outcome.code : 'ok',
    })

    return sent.outcome
  } catch (err: unknown) {
    logRequest(state.logger, { request, startedTick, status: 'aborted' })
    throw err
  }
}

interface RequestTiming {
  readonly request: SourceRequest
  readonly startedTick: number
  /** When the request left, so a queue wait reads apart from a slow host. Absent when it never
   *  reached the wire. */
  readonly sentTick?: number
  readonly status: CaveatCode | 'ok' | 'aborted'
}

function logRequest(logger: Logger, timing: RequestTiming): void {
  const finishedTick = performance.now()

  logger.debug('trading.source_request', {
    sourceId: timing.request.sourceId,
    path: timing.request.path,
    status: timing.status,
    elapsedMs: Math.round(finishedTick - timing.startedTick),
    pacedMs: Math.round((timing.sentTick ?? finishedTick) - timing.startedTick),
  })
}

/** Carries the tick the request left at, which only this function knows: the pacer may hold a call
 *  for a whole minute, and a wait counted as latency reads as a slow provider. */
interface SentRequest<T> {
  readonly outcome: SourceFetchOutcome<T>
  readonly sentTick?: number
}

async function sendRequest<T>(
  state: SourceHttpState,
  request: SourceRequest,
  map: (text: string, fetchedAt: number) => T
): Promise<SentRequest<T>> {
  const target = resolveTarget(state.facts, state.endpoints, request)

  if (!target) {
    return { outcome: { kind: 'error', code: 'source.unavailable' } }
  }

  const prepared = prepareOutbound(state.facts, request, target)
  const deadlineTick = performance.now() + REQUEST_BUDGET_MS
  const budget = AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_BUDGET_MS)])

  const refused = await admitRequest(state, request, budget)

  if (refused) {
    return { outcome: refused }
  }

  const sentTick = performance.now()
  let text: string
  let fetchedAt: number

  try {
    text = await sendWithRetry({ state, target, request, prepared, budget, deadlineTick })
    fetchedAt = state.now()
  } catch (err: unknown) {
    const outcome = budget.aborted
      ? abortedOutcome<T>(state, request)
      : mapFetchError<T>(state, err, request)

    return { outcome, sentTick }
  }

  try {
    const value = map(text, fetchedAt)

    state.health.recordSuccess(request.sourceId, fetchedAt)

    return { outcome: { kind: 'ok', value, fetchedAt }, sentTick }
  } catch (err: unknown) {
    // A body that is not JSON at all (a bot-check page, an HTML error) is the provider failing
    // while answering 200, so it counts against the breaker like any failed round trip.
    if (err instanceof SyntaxError) {
      return { outcome: mapFetchError<T>(state, err, request), sentTick }
    }

    // A schema mismatch is valid JSON of the wrong shape, not a transport failure: the round trip
    // was healthy, and recording it against the breaker would let one kind's drift cool down every
    // other kind this provider serves. The reason is logged because the caveat cannot carry it.
    state.health.recordSuccess(request.sourceId, fetchedAt)
    state.logger.warn('trading.source_payload_rejected', {
      sourceId: request.sourceId,
      path: request.path,
      err: formatErrForLog(err),
    })

    return { outcome: { kind: 'error', code: 'source.payload-rejected' }, sentTick }
  }
}

interface RetriedSend {
  readonly state: SourceHttpState
  readonly target: RequestTarget
  readonly request: SourceRequest
  readonly prepared: PreparedRequest
  readonly budget: AbortSignal
  /** `performance.now()` tick the budget expires at, so a retry can tell whether a server-set wait
   *  fits in what is left. */
  readonly deadlineTick: number
}

/** The caller took the first token before it started the clock, so a queue wait still reads apart
 *  from host latency; every retry takes its own. A retry is another request the provider has to
 *  serve, and `httpRequestWithSignal` tries every host inside each one, so acquiring once let a
 *  single token become six requests aimed at a provider that had just refused one. */
function sendWithRetry(input: RetriedSend): Promise<string> {
  const { state, request, budget } = input
  let sent = 0

  return withRetry(
    async () => {
      if (sent > 0 && (await state.pacer.acquire(request.sourceId, budget)) === 'aborted') {
        throw abortError(budget)
      }

      sent += 1

      return send(input.target, request, {
        ...input.prepared,
        signal: budget,
      })
    },
    retryOptions(state, input)
  )
}

/** Both arms of a settled budget. A caller's cancel is not a provider failure and never trips the
 *  breaker; our own deadline is a provider that was too slow. Decided from the signals rather than
 *  from an error's name, because `AbortSignal.timeout` rejects with `TimeoutError`. */
function abortedOutcome<T>(state: SourceHttpState, request: SourceRequest): SourceFetchOutcome<T> {
  if (request.signal.aborted) {
    throw abortError(request.signal)
  }

  const code: CaveatCode = 'source.timeout'

  state.health.recordFailure(request.sourceId, { code })

  return { kind: 'error', code }
}

function send(
  target: RequestTarget,
  request: SourceRequest,
  prepared: PreparedRequest & { readonly signal: AbortSignal }
): Promise<string> {
  const { jsonBody } = request

  return httpRequestWithSignal({
    hosts: target.hosts,
    path: target.path,
    maxBytes: MAXIMUM_RESPONSE_BYTES,
    signal: prepared.signal,
    hostTimeoutMs: request.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS,
    ...(prepared.query ? { query: { ...prepared.query } } : {}),
    ...(jsonBody === undefined
      ? { ...(prepared.headers ? { headers: { ...prepared.headers } } : {}) }
      : {
          method: 'POST',
          body: JSON.stringify(jsonBody),
          headers: { ...prepared.headers, 'content-type': JSON_CONTENT_TYPE },
        }),
  }).then((response) => response.text)
}

// A 429/503's Retry-After, capped at the breaker cooldown. The one parse behind both the retry
// floor and the breaker's backoff, so the two cannot disagree.
function serverFloorMs(state: SourceHttpState, err: unknown): number | undefined {
  return err instanceof HttpRequestError
    ? parseRetryAfterMs(err.retryAfter, state.now(), BREAKER_COOLDOWN_MS)
    : undefined
}

function retryOptions(state: SourceHttpState, input: RetriedSend): Parameters<typeof withRetry>[1] {
  const { budget, request, deadlineTick } = input

  return {
    signal: budget,
    maxAttempts: request.maxAttempts ?? RETRY_MAXIMUM_ATTEMPTS,
    initialMs: RETRY_INITIAL_DELAY_MS,
    maxMs: RETRY_MAXIMUM_DELAY_MS,
    // A floor longer than what is left would abort the sleep mid-way and read as our own timeout;
    // not retrying lets the 429 itself reach mapFetchError, which records the Retry-After.
    isRetryable: (err: unknown) =>
      isRetryable(err) && (serverFloorMs(state, err) ?? 0) < deadlineTick - performance.now(),
    // A server-supplied floor, not a suggestion: withRetry's backoff still applies on top, but
    // never sleeps less than the provider asked for.
    delayFor: (err: unknown) => serverFloorMs(state, err) ?? 0,
  }
}

// catch-block error→caveat mapping: provider-documented business miss, then the generic
// HttpRequestError→CaveatCode fallback with its Retry-After. A settled budget never arrives here;
// `run` routes it to `abortedOutcome` first. A spent attempt deadline does: it left the budget
// alive, so it is the last attempt's own failure.
function mapFetchError<T>(
  state: SourceHttpState,
  err: unknown,
  request: SourceRequest
): SourceFetchOutcome<T> {
  // The core seam discards non-2xx bodies, so only a provider-documented status can mark a business
  // miss. Neither it nor an empty success says the provider is unhealthy.
  if (
    err instanceof HttpRequestError &&
    err.status !== undefined &&
    request.businessMissStatuses?.includes(err.status) === true
  ) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const code = toCaveatCode(err)

  state.failures.report(request, code, err)

  const retryAfterMs = serverFloorMs(state, err)

  state.health.recordFailure(request.sourceId, {
    code,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  })

  return { kind: 'error', code }
}
