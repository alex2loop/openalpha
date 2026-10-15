import { isAbortError } from '@/core/errors'
import { HttpRequestError, httpRequestWithSignal } from '@/core/http-client'
import { withRetry } from '@/core/utils/retry'
import { OrderError } from '@/trading/features/order/types'

const ATTEMPT_TIMEOUT_MS = 10_000
const REQUEST_BUDGET_MS = 30_000
const READ_MAXIMUM_ATTEMPTS = 3
const RETRY_INITIAL_DELAY_MS = 500
const RETRY_MAXIMUM_DELAY_MS = 5_000
// 429 asks for slower traffic and 418 is the ban a client earns by ignoring it; replaying either
// inside the retry window only deepens it.
const RATE_LIMIT_STATUSES: ReadonlySet<number> = new Set([418, 429])

export interface VenueRequest {
  readonly method: 'GET' | 'POST' | 'DELETE'
  readonly path: string
  readonly headers: Record<string, string>
  readonly query?: Record<string, string>
  readonly body?: string
  /** Statuses whose body is the venue's answer rather than a failed attempt. */
  readonly errorBodyStatuses?: readonly number[]
  readonly maxBytes?: number
  readonly signal: AbortSignal
}

/** Returns the body text, not the response: `HttpResponse` is internal to `core/http-client`, and
 *  no venue reads a header. `signal` is the call's budget; the attempt deadline is armed here
 *  because `httpRequestWithSignal` arms none by contract. */
export interface VenueTransport {
  send(request: VenueRequest): Promise<string>
}

export function createVenueTransport(hosts: readonly string[]): VenueTransport {
  return {
    send: async (request) => {
      try {
        const response = await httpRequestWithSignal({
          hosts,
          path: request.path,
          method: request.method,
          headers: request.headers,
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]),
          ...(request.query === undefined ? {} : { query: request.query }),
          ...(request.body === undefined ? {} : { body: request.body }),
          ...(request.errorBodyStatuses === undefined
            ? {}
            : { errorBodyStatuses: request.errorBodyStatuses }),
          ...(request.maxBytes === undefined ? {} : { maxBytes: request.maxBytes }),
        })

        return response.text
      } catch (err: unknown) {
        // A caller's abort on a read surfaces as itself. A write keeps `order.network` even then:
        // it may already have reached the venue, and only that code recovers it by client id.
        if (request.method === 'GET' && isAbortError(err) && request.signal.aborted) {
          throw err
        }

        throw toOrderError(err)
      }
    },
  }
}

function toOrderError(err: unknown): OrderError {
  if (
    err instanceof HttpRequestError &&
    err.status !== undefined &&
    RATE_LIMIT_STATUSES.has(err.status)
  ) {
    return new OrderError('order.rate_limited', `the venue answered ${err.status}`, err)
  }

  return new OrderError('order.network', 'the request failed', err)
}

/** One budget for the whole call, with an attempt deadline inside it. The budget is tested in the
 *  predicate so a spent one reports at once instead of burning its remaining attempts against a
 *  signal that is already settled. */
export function retriedRead<T>(
  signal: AbortSignal,
  once: (budget: AbortSignal) => Promise<T>
): Promise<T> {
  const budget = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_BUDGET_MS)])

  return withRetry(() => once(budget), {
    signal,
    maxAttempts: READ_MAXIMUM_ATTEMPTS,
    initialMs: RETRY_INITIAL_DELAY_MS,
    maxMs: RETRY_MAXIMUM_DELAY_MS,
    isRetryable: (err: unknown) =>
      !budget.aborted && err instanceof OrderError && err.code === 'order.network',
  })
}

/** A write is never replayed: an order is not idempotent once its client id stops deduping, which
 *  happens the moment the first one settles. */
export function unretried<T>(
  signal: AbortSignal,
  once: (budget: AbortSignal) => Promise<T>
): Promise<T> {
  return once(AbortSignal.any([signal, AbortSignal.timeout(REQUEST_BUDGET_MS)]))
}

interface ClockReading {
  /** Local clock before the time request left and after its reply arrived. */
  readonly sentAt: number
  readonly receivedAt: number
  readonly serverMs: number
  /** How far the local clock may run ahead of the venue, and how far behind it. */
  readonly maximumLeadMs: number
  readonly maximumLagMs: number
}

/** The venue stamps its time somewhere inside the round trip, so it is held against the trip's
 *  midpoint: read after the reply, the trip back alone would count as skew. The bounds are the
 *  venue's own signature window less a margin the caller chooses, because a stamp that passes here
 *  can still be refused by the time the signed request lands. */
export function assertClockWithin(reading: ClockReading): void {
  const lead = (reading.sentAt + reading.receivedAt) / 2 - reading.serverMs

  if (lead > reading.maximumLeadMs || -lead > reading.maximumLagMs) {
    throw new OrderError('order.clock_skew', 'the local clock is too far from exchange time')
  }
}
