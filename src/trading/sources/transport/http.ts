import type { Logger } from '@/core/logging/logger'
import type { CaveatCode } from '@/trading/kernel/caveat'
import type { EndpointMaps } from '@/trading/sources/transport/request-target'
import type { WireState } from '@/trading/sources/transport/wire'
import type {
  PagedSourceRequest,
  SourceFacts,
  SourceFetchOutcome,
  SourceHttp,
  SourceRequest,
} from '@/trading/sources/types'
import { formatErrForLog } from '@/core/security/credentials'
import { createRequestCoalescer } from '@/trading/sources/coalesce'
import { createSourceHealthLog } from '@/trading/sources/transport/health'
import { createFailureReporter } from '@/trading/sources/transport/http-failure'
import { createPacer } from '@/trading/sources/transport/pacer'
import {
  buildEndpointMaps,
  prepareOutbound,
  resolveTarget,
} from '@/trading/sources/transport/request-target'
import { BREAKER_COOLDOWN_MS, mapFetchError, readWire } from '@/trading/sources/transport/wire'

// Follow-up pages one fetch will chase. Hitting it yields a `source.truncated` caveat rather than
// an unbounded loop against one provider.
const MAXIMUM_PAGES = 20
// The whole page set. Each page still carries its own REQUEST_BUDGET_MS inside this, so without it
// a twenty-page read is twenty budgets in series with nothing over them.
const PAGE_SET_BUDGET_MS = 120_000

// Breaker tuning, same standing as the network bounds in `wire.ts`.
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

interface SourceHttpState extends WireState {
  readonly endpoints: EndpointMaps
  readonly logger: Logger
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
    pacer: createPacer(facts.rateLimits, facts.burstLimits),
    now,
    logger,
    failures: createFailureReporter(logger),
    reads: createRequestCoalescer(),
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

  const wire = await readWire(state, {
    request,
    target,
    prepared: prepareOutbound(state.facts, request, target),
  })

  if (wire.kind === 'error') {
    return {
      outcome: wire.outcome,
      ...(wire.sentTick === undefined ? {} : { sentTick: wire.sentTick }),
    }
  }

  const { text, fetchedAt, sentTick } = wire

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
