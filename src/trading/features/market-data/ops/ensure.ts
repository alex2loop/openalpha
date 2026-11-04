import type { Logger } from '@/core/logging/logger'
import type { RefreshMarketData } from '@/trading/features/market-data/ops/refresh'
import type { MarketDataStore } from '@/trading/features/market-data/store/market-data'
import type { Caveat } from '@/trading/kernel/caveat'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { MarketRefreshAttempt } from '@/trading/kernel/market/refresh'
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
const FIRST_LOAD_PENDING_ANSWER: readonly Caveat[] = Object.freeze([FIRST_LOAD_PENDING])

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
  /** The app's lifetime. A refresh a read starts belongs to it, not to the read: a partial answer
   *  returns while that refresh goes on, and the read's own signal ends only the waiting. */
  readonly signal: AbortSignal
  readonly logger: Logger
}

/** The one owner of "a read found no daemon", and only that: a market with nothing stored is warmed
 *  so a fresh install answers, and from then on `/refresh` and the scheduled tick own currency. A
 *  read that refetched whenever a kind aged made the first command after every rollover pay for the
 *  whole board, which is a fetch the operator did not ask for and cannot see coming. What the store
 *  does hold answers instead, carrying the session it stands for. */
export function createEnsureMarketData(deps: EnsureMarketDataDeps): EnsureMarketData {
  return async (options) => {
    const populated = await listPopulated(deps, options.market, options.signal)

    if (populated.length > 0 && !deps.firstLoading.has(options.market)) {
      return buildStaleCaveats(deps, options, populated)
    }

    if (options.partialAnswer === true) {
      return populated.length > 0 ? FIRST_LOAD_PENDING_ANSWER : answerAfterFirstKind(deps, options)
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

/** Joins the market's first refresh until its first kind is stored, the budget runs out or the
 *  refresh ends, whichever is first, and then answers from the store. The refresh is not the read's:
 *  it keeps running after this returns, so its failure is logged here, once, whether or not the read
 *  is still waiting to carry it. */
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
      untilFirstKindStored(deps, options.market, signal).then(() => FIRST_LOAD_PENDING_ANSWER),
      sleep(FIRST_LOAD_BUDGET_MS, signal).then(() => FIRST_LOAD_PENDING_ANSWER),
    ])
  } finally {
    waiting.abort()
  }
}

async function untilFirstKindStored(
  deps: EnsureMarketDataDeps,
  market: MarketRef,
  signal: AbortSignal
): Promise<void> {
  while ((await listPopulated(deps, market, signal)).length === 0) {
    await sleep(FIRST_KIND_POLL_MS, signal)
  }
}

/** The market names the kinds a refresh would refetch, because only it knows their cadences —
 *  holding every kind to the settled day warns about a listing set replaced weekly and names a
 *  command that will correctly decline to run. The oldest of those kinds dates the caveat: a board
 *  priced through Friday whose flows stop on Wednesday is two sessions behind. */
async function buildStaleCaveats(
  deps: EnsureMarketDataDeps,
  options: EnsureMarketDataOptions,
  populated: readonly MarketRefreshAttempt[]
): Promise<readonly Caveat[]> {
  const market = deps.markets.find(options.market)
  const stale =
    (await market?.capabilities.staleKinds?.run({
      attempts: populated,
      now: options.now,
      signal: options.signal,
    })) ?? []
  const [asOf] = populated
    .filter((attempt) => stale.includes(attempt.result.kind))
    .map((attempt) => attempt.asOf)
    .sort()

  return asOf === undefined ? [] : [{ code: 'market-data.evidence-stale', detail: { asOf } }]
}

async function listPopulated(
  deps: EnsureMarketDataDeps,
  market: MarketRef,
  signal: AbortSignal
): Promise<readonly MarketRefreshAttempt[]> {
  const attempts = await deps.marketDataStore.listRefreshAttempts({ market, signal })

  return attempts.filter((attempt) => attempt.result.recordCount > 0)
}
