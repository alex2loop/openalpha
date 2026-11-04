import type { CaveatCode } from '@/trading/kernel/caveat'
import type { RequestCoalescer } from '@/trading/sources/coalesce'
import type { SourceHealthLog } from '@/trading/sources/transport/health'
import type { FailureReporter } from '@/trading/sources/transport/http-failure'
import type { Pacer } from '@/trading/sources/transport/pacer'
import type { PreparedRequest, RequestTarget } from '@/trading/sources/transport/request-target'
import type { SourceFacts, SourceFetchOutcome, SourceRequest } from '@/trading/sources/types'
import { abortError } from '@/core/errors'
import { HttpRequestError, httpRequestWithSignal, parseRetryAfterMs } from '@/core/http-client'
import { withRetry } from '@/core/utils/retry'
import { providerRequestKey } from '@/trading/sources/coalesce'
import { admitRequest } from '@/trading/sources/transport/admission'
import { isRetryable, toCaveatCode } from '@/trading/sources/transport/http-failure'

/** What a round trip needs of the transport's state; `SourceHttpState` adds what only a whole
 *  request needs. */
export interface WireState {
  readonly facts: SourceFacts
  readonly health: SourceHealthLog
  readonly pacer: Pacer
  readonly now: () => number
  readonly failures: FailureReporter
  readonly reads: RequestCoalescer
}

// Network tuning, not operator judgment: a provider either answers inside these bounds or the
// failover order moves on. The budget governs pacing, every attempt, and every retry sleep; each
// attempt carries its own deadline inside it, so one slow reply costs an attempt, not the request.
const ATTEMPT_TIMEOUT_MS = 10_000
const REQUEST_BUDGET_MS = 35_000
const MAXIMUM_RESPONSE_BYTES = 2_097_152
const RETRY_MAXIMUM_ATTEMPTS = 3
const RETRY_INITIAL_DELAY_MS = 500
const RETRY_MAXIMUM_DELAY_MS = 5_000
const JSON_CONTENT_TYPE = 'application/json'
export const BREAKER_COOLDOWN_MS = 300_000

interface WireRequest {
  readonly request: SourceRequest
  readonly target: RequestTarget
  readonly prepared: PreparedRequest
}

/** What came back before any caller reads it: the body, or the outcome that stopped it. Each
 *  caller maps the text itself, so two kinds reading one endpoint still parse their own shape. */
type Wire =
  | {
      readonly kind: 'ok'
      readonly text: string
      readonly fetchedAt: number
      readonly sentTick: number
    }
  | {
      readonly kind: 'error'
      readonly outcome: SourceFetchOutcome<never>
      readonly sentTick?: number
    }

/** One round trip per identical GET in flight, whoever asks: the macro gate reads the same series
 *  for each day a market scores against, and each read otherwise spent a call of the provider's
 *  quota. The wire is shared before pacing, so a joiner takes no token, and its failure counts
 *  against the breaker once. A POST body is not part of the key, so a POST is never merged. */
export function readWire(state: WireState, input: WireRequest): Promise<Wire> {
  const { request } = input

  if (request.jsonBody !== undefined) {
    return fetchWire(state, input)
  }

  return state.reads.share(providerRequestKey(request), request.signal, (shared) =>
    fetchWire(state, { ...input, request: { ...request, signal: shared } })
  )
}

async function fetchWire(state: WireState, input: WireRequest): Promise<Wire> {
  const { request, target, prepared } = input
  const deadlineTick = performance.now() + REQUEST_BUDGET_MS
  const budget = AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_BUDGET_MS)])
  const refused = await admitRequest(state, request, budget)

  if (refused) {
    return { kind: 'error', outcome: refused }
  }

  const sentTick = performance.now()

  try {
    const text = await sendWithRetry({ state, target, request, prepared, budget, deadlineTick })

    return { kind: 'ok', text, fetchedAt: state.now(), sentTick }
  } catch (err: unknown) {
    const outcome = budget.aborted
      ? abortedOutcome<never>(state, request)
      : mapFetchError<never>(state, err, request)

    return { kind: 'error', outcome, sentTick }
  }
}

interface RetriedSend {
  readonly state: WireState
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

      return send(input, { ...input.prepared, signal: budget })
    },
    retryOptions(state, input)
  )
}

/** Both arms of a settled budget. A caller's cancel is not a provider failure and never trips the
 *  breaker; our own deadline is a provider that was too slow. Decided from the signals rather than
 *  from an error's name, because `AbortSignal.timeout` rejects with `TimeoutError`. */
function abortedOutcome<T>(state: WireState, request: SourceRequest): SourceFetchOutcome<T> {
  if (request.signal.aborted) {
    throw abortError(request.signal)
  }

  const code: CaveatCode = 'source.timeout'

  state.health.recordFailure(request.sourceId, { code })

  return { kind: 'error', code }
}

function send(
  input: RetriedSend,
  prepared: PreparedRequest & { readonly signal: AbortSignal }
): Promise<string> {
  const { target, request } = input
  const { jsonBody } = request

  return httpRequestWithSignal({
    shape: input.state.facts.requestShape,
    hosts: target.hosts,
    path: target.path,
    maxBytes: request.maxBytes ?? MAXIMUM_RESPONSE_BYTES,
    signal: prepared.signal,
    hostTimeoutMs:
      request.attemptTimeoutMs ?? input.state.facts.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS,
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
function serverFloorMs(state: WireState, err: unknown): number | undefined {
  return err instanceof HttpRequestError
    ? parseRetryAfterMs(err.retryAfter, state.now(), BREAKER_COOLDOWN_MS)
    : undefined
}

function retryOptions(state: WireState, input: RetriedSend): Parameters<typeof withRetry>[1] {
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
export function mapFetchError<T>(
  state: WireState,
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
