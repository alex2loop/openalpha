import type { Logger } from '@/core/logging/logger'
import type { RefreshMarketData } from '@/trading/features/market-data/ops/refresh'
import type { MarketDataStore } from '@/trading/features/market-data/store/market-data'
import type { Caveat } from '@/trading/kernel/caveat'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { MarketRefreshAttempt, RefreshKindStatus } from '@/trading/kernel/market/refresh'
import type { StageReporter } from '@/trading/kernel/surface/tool-progress'
import type { MarketRegistry } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { sleep } from '@/core/utils/time'

/** Ceiling for a refresh that stores nothing: the first kind landing (the VN listing, about 11 s in)
 *  ends the wait sooner. Keeps the read well inside the 120 s the host allows it. */
const FIRST_LOAD_BUDGET_MS = 30_000
/** How often the wait looks for a stored kind. It reads the store, never a provider. */
const FIRST_KIND_POLL_MS = 500
/** Carried by an answer given while the market's first refresh is still running. */
export const FIRST_LOAD_PENDING: Caveat = Object.freeze({ code: 'market-data.first-load-pending' })
/** Carried while the market's first refresh stopped partway and no refresh has completed since. */
export const FIRST_LOAD_INCOMPLETE: Caveat = Object.freeze({
  code: 'market-data.first-load-incomplete',
})
const FIRST_LOAD_PENDING_ANSWER: readonly Caveat[] = Object.freeze([FIRST_LOAD_PENDING])
/** A kind whose last pass stored nothing new. `partial` is left out: a wide board where a few names
 *  are never served settles partial on every pass, and a caveat that never clears is noise. */
const FAILED_STATUSES: ReadonlySet<RefreshKindStatus> = new Set(['retained', 'unavailable'])

export interface EnsureMarketDataOptions {
  readonly market: MarketRef
  readonly now: number
  readonly signal: AbortSignal
  readonly progress?: StageReporter
  /** The read persists nothing and spends nothing, and the next one repeats it, so while the market
   *  has no stored kind it may answer from the first one to land instead of the whole refresh. */
  readonly partialAnswer?: true
}

export type EnsureMarketData = (options: EnsureMarketDataOptions) => Promise<readonly Caveat[]>

interface EnsureMarketDataDeps {
  readonly markets: MarketRegistry
  readonly marketDataStore: Pick<MarketDataStore, 'listRefreshAttempts'>
  readonly refresh: RefreshMarketData
  /** Markets whose refresh started on an empty store and has not settled; the coordinator owns it. */
  readonly firstLoading: ReadonlySet<MarketRef>
  /** Markets whose first refresh rejected and no later one has completed; the coordinator owns it. */
  readonly firstLoadFailed: ReadonlySet<MarketRef>
  /** The app's lifetime. A refresh a read starts belongs to it, not to the read: a partial answer
   *  returns while that refresh goes on, and the read's own signal ends only the waiting. */
  readonly signal: AbortSignal
  readonly logger: Logger
}

/** The one owner of "a read found no daemon", and only that: a market with nothing stored is warmed
 *  so a fresh install answers, and from then on `/refresh` and the scheduled tick own currency. A
 *  read that refetched whenever a kind aged made the first command after every rollover pay for the
 *  whole board, which is a fetch the operator did not ask for and cannot see coming. What the store
 *  does hold answers instead, carrying the session it stands for.
 *
 *  A market is warmed once any of its kinds has an attempt row, whatever that pass stored: a pass
 *  that found nothing new, or failed, is still an answer, and reading it as absent refetched on
 *  every read. A failed first attempt is reported as `refresh-failed`, and the scheduled tick or
 *  `/refresh` retries it. */
export function createEnsureMarketData(deps: EnsureMarketDataDeps): EnsureMarketData {
  return async (options) => {
    const attempts = await listAttempts(deps, options.market, options.signal)
    const refreshed = attempts.length > 0

    if (refreshed && !deps.firstLoading.has(options.market)) {
      const stale = await buildStaleCaveats(deps, options, attempts)

      return deps.firstLoadFailed.has(options.market) ? [FIRST_LOAD_INCOMPLETE, ...stale] : stale
    }

    if (options.partialAnswer === true) {
      return refreshed ? FIRST_LOAD_PENDING_ANSWER : answerAfterFirstKind(deps, options)
    }

    const result = await deps.refresh({
      market: options.market,
      now: options.now,
      signal: options.signal,
      ...(options.progress === undefined ? {} : { progress: options.progress }),
    })

    return result.caveats
  }
}

/** Joins the market's first refresh until its first kind has an attempt on record, the budget runs
 *  out or the refresh ends, whichever is first, and then answers from the store. The refresh is not
 *  the read's: it keeps running after this returns, so its failure is logged here, once, whether or
 *  not the read is still waiting to carry it. */
async function answerAfterFirstKind(
  deps: EnsureMarketDataDeps,
  options: EnsureMarketDataOptions
): Promise<readonly Caveat[]> {
  const { progress } = options
  // Ends the poll and the budget timer on every way out; the read's own abort ends them too.
  const waiting = new AbortController()
  const signal = AbortSignal.any([options.signal, waiting.signal])
  const refreshing = deps.refresh({
    market: options.market,
    now: options.now,
    signal: deps.signal,
    // A line after the read has answered would be painted on a command that already ended.
    ...(progress === undefined
      ? {}
      : {
          progress: (key, params) => {
            if (!waiting.signal.aborted) {
              progress(key, params)
            }
          },
        }),
  })

  refreshing.catch((err: unknown) => {
    if (!isAbortError(err)) {
      deps.logger.warn('market-data.first_load_refresh_failed', {
        market: options.market,
        err: formatErrForLog(err),
      })
    }
  })

  try {
    return await Promise.race([
      refreshing.then((result) => result.caveats),
      untilFirstKindAttempted(deps, options.market, signal).then(() => FIRST_LOAD_PENDING_ANSWER),
      sleep(FIRST_LOAD_BUDGET_MS, signal).then(() => FIRST_LOAD_PENDING_ANSWER),
    ])
  } finally {
    waiting.abort()
  }
}

async function untilFirstKindAttempted(
  deps: EnsureMarketDataDeps,
  market: MarketRef,
  signal: AbortSignal
): Promise<void> {
  while ((await listAttempts(deps, market, signal)).length === 0) {
    await sleep(FIRST_KIND_POLL_MS, signal)
  }
}

/** The market names the kinds a refresh would refetch, because only it knows their cadences —
 *  holding every kind to the settled day warns about a listing set replaced weekly and names a
 *  command that will correctly decline to run. The oldest of those kinds dates the caveat: a board
 *  priced through Friday whose flows stop on Wednesday is two sessions behind.
 *
 *  A kind whose latest attempt settled short reads as current by its stamps, since the failed pass
 *  is the newest one, so its status speaks instead: one caveat naming the kind, which also takes it
 *  out of the stale date. The stamp is the session the attempt stood for, so the data is no newer
 *  than it and may be older. Every attempt is judged, whatever it stored: staleness reads the stamp,
 *  and a pass that found nothing new still stands for its session. */
async function buildStaleCaveats(
  deps: EnsureMarketDataDeps,
  options: EnsureMarketDataOptions,
  attempts: readonly MarketRefreshAttempt[]
): Promise<readonly Caveat[]> {
  const failed = attempts.filter((attempt) => FAILED_STATUSES.has(attempt.result.status))
  const failedKinds = new Set(failed.map((attempt) => attempt.result.kind))
  const market = deps.markets.find(options.market)
  const stale =
    (await market?.capabilities.staleKinds?.run({
      attempts,
      now: options.now,
      signal: options.signal,
    })) ?? []
  const [asOf] = attempts
    .filter(
      (attempt) => stale.includes(attempt.result.kind) && !failedKinds.has(attempt.result.kind)
    )
    .map((attempt) => attempt.asOf)
    .sort()
  const refreshFailed = failed.map(
    (attempt): Caveat => ({
      code: 'market-data.refresh-failed',
      detail: { kind: attempt.result.kind, asOf: attempt.asOf },
    })
  )

  return asOf === undefined
    ? refreshFailed
    : [{ code: 'market-data.evidence-stale', detail: { asOf } }, ...refreshFailed]
}

async function listAttempts(
  deps: EnsureMarketDataDeps,
  market: MarketRef,
  signal: AbortSignal
): Promise<readonly MarketRefreshAttempt[]> {
  return deps.marketDataStore.listRefreshAttempts({ market, signal })
}
