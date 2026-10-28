import type { Logger } from '@/core/logging/logger'
import type { ScheduledRunner } from '@/core/types/command'
import type { TradeSidesSweep } from '@/trading/features/market-data/ops/trade-sides'
import type { MarketDataStore } from '@/trading/features/market-data/store/market-data'
import type { NewsArchiveStore } from '@/trading/features/market-data/store/news-archive'
import type { Caveat } from '@/trading/kernel/caveat'
import type { MarketRef } from '@/trading/kernel/instrument'
import type {
  MarketRefreshAttempt,
  RefreshAllMarketDataOptions,
  RefreshKindResult,
  RefreshKindStatus,
  RefreshMarketDataOptions,
  RefreshMarketDataResult,
} from '@/trading/kernel/market/refresh'
import type { StageReporter } from '@/trading/kernel/surface/tool-progress'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { isAbortError, ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { refreshAnchorsForMarket } from '@/trading/features/market-data/ops/refresh-schedule'
import { applyRetention } from '@/trading/features/market-data/ops/retention'
import { caveatSeverity, dedupeCaveats } from '@/trading/kernel/caveat'
import { reportRefreshJoined, SCHEDULED_REFRESH } from '@/trading/kernel/market/refresh'
import { createSharedFlight, type SharedFlight } from '@/trading/kernel/shared-flight'
import { resolveSettledDay } from '@/trading/markets/calendar'

/** How many lost targets a caveat names before it reports the rest as a count. A report of every
 *  name in a wide universe is not a report. */
const MISSING_TARGET_SAMPLE = 8
/** Statuses that settled short of the population the kind was asked for. */
const DEGRADED_STATUSES: ReadonlySet<RefreshKindStatus> = new Set([
  'partial',
  'retained',
  'unavailable',
])
/** Statuses that put rows in the store. Retention ages rows out by when they were last fetched, so
 *  a sweep after a pass that replaced nothing deletes evidence the failed pass was meant to renew.
 *  `partial` is in: a replayed degraded attempt keeps it too, so a market stuck short still sweeps,
 *  trimming only the names it could not refresh. That is what stops a permanently incomplete board
 *  from growing without bound. */
const WRITING_STATUSES: ReadonlySet<RefreshKindStatus> = new Set([
  'replaced',
  'upserted',
  'partial',
])

interface RefreshCoordinatorDeps {
  readonly markets: MarketRegistry
  readonly marketDataStore: MarketDataStore
  readonly newsArchive: Pick<NewsArchiveStore, 'deleteFetchedBefore'>
  readonly universeLimit: number
  readonly logger: Logger
}

export interface EnsureMarketDataOptions {
  readonly market: MarketRef
  readonly now: number
  readonly signal: AbortSignal
  readonly progress?: StageReporter
}

export type EnsureMarketData = (options: EnsureMarketDataOptions) => Promise<readonly Caveat[]>

interface EnsureMarketDataDeps {
  readonly markets: MarketRegistry
  readonly marketDataStore: Pick<MarketDataStore, 'listRefreshAttempts'>
  readonly refresh: RefreshMarketData
}

/** The one owner of "a read found no daemon", and only that: a market with nothing stored is warmed
 *  so a fresh install answers, and from then on `/refresh` and the scheduled tick own currency. A
 *  read that refetched whenever a kind aged made the first command after every rollover pay for the
 *  whole board, which is a fetch the operator did not ask for and cannot see coming. What the store
 *  does hold answers instead, carrying the session it stands for. */
export function createEnsureMarketData(deps: EnsureMarketDataDeps): EnsureMarketData {
  return async (options) => {
    const attempts = await deps.marketDataStore.listRefreshAttempts({
      market: options.market,
      signal: options.signal,
    })
    const populated = attempts.filter((attempt) => attempt.result.recordCount > 0)

    if (populated.length === 0) {
      const result = await deps.refresh({
        market: options.market,
        now: options.now,
        signal: options.signal,
        ...(options.progress === undefined ? {} : { progress: options.progress }),
      })

      return result.caveats
    }

    return buildStaleCaveats(deps, options, populated)
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

export type RefreshMarketData = (
  options: RefreshMarketDataOptions
) => Promise<RefreshMarketDataResult>

interface InFlightRefresh {
  readonly forced: boolean
  readonly flight: SharedFlight<RefreshMarketDataResult>
}

/** One coordinator owns same-market serialization, so an interactive refresh and a scheduled one
 *  share a single fetch instead of racing to replace the same scope. The daemon task adds no
 *  second guard. */
export function createRefreshCoordinator(deps: RefreshCoordinatorDeps): RefreshMarketData {
  // Bounded by the registered market count — fixed cardinality, so no eviction policy is needed.
  const inFlight = new Map<MarketRef, InFlightRefresh>()

  return function refresh(options): Promise<RefreshMarketDataResult> {
    const forced = options.forced ?? false
    const existing = inFlight.get(options.market)

    // A forced request queues behind an unforced sweep rather than joining it: that sweep was
    // allowed to skip fresh scopes. Every other pairing shares the one already in flight, unless
    // every caller of that one has already cancelled it.
    if (existing?.flight.live && (existing.forced || !forced)) {
      // The joined sweep runs under its own reporter, so this caller's would otherwise stay silent
      // for however long that sweep has left.
      reportRefreshJoined(options.progress, options.market)

      return existing.flight.attach(options.signal)
    }

    const entry: InFlightRefresh = {
      forced,
      flight: createSharedFlight((signal) =>
        runRefreshAfter(deps, { ...options, signal }, existing?.flight.work)
      ),
    }
    // Evicting on success, failure, and abort alike: evicting only on success turns this map into
    // a permanent leak that blocks a market forever after one failure. The identity check stops a
    // settling sweep from evicting the forced pass queued behind it.
    const evict = (): void => {
      if (inFlight.get(options.market) === entry) {
        inFlight.delete(options.market)
      }
    }

    inFlight.set(options.market, entry)
    entry.flight.work.then(evict, evict)

    return entry.flight.attach(options.signal)
  }
}

/** The preceding sweep belongs to its own callers, so its failure is swallowed here: it is awaited
 *  for ordering, never for its result. */
async function runRefreshAfter(
  deps: RefreshCoordinatorDeps,
  options: RefreshMarketDataOptions,
  preceding: Promise<RefreshMarketDataResult> | undefined
): Promise<RefreshMarketDataResult> {
  if (preceding !== undefined) {
    await preceding.catch(() => undefined)
  }

  return runRefresh(deps, options)
}

interface RefreshOperationDeps {
  readonly refresh: RefreshMarketData
  readonly markets: readonly MarketRef[]
  /** What an unqualified refresh sweeps: the markets the operator still reads. */
  inUse(signal: AbortSignal): Promise<ReadonlySet<MarketRef>>
  /** Rides the refresh rather than a clock of its own: every path that refreshes market data —
   *  boot, the daemon loop, and `/refresh` — is a path that should fill a missing settled session. */
  readonly recordTradeSides: TradeSidesSweep
  /** Shows a scheduled pass as the `/refresh` run, so the page sees the daemon's own sweeps. */
  readonly runScheduled: ScheduledRunner
  readonly logger: Logger
}

/** No cursor and no second in-flight guard: the coordinator already serializes per market, so a
 *  tick that overlaps an interactive refresh shares that fetch instead of racing it. Markets run
 *  together because they share almost no provider, and the pacer meters the ones they do — waiting
 *  on each other only made the tick as slow as the sum of independent hosts. */
export function createRefreshTick(
  deps: RefreshOperationDeps
): (options: RefreshAllMarketDataOptions) => Promise<readonly RefreshMarketDataResult[]> {
  return async (options) => {
    const requested = new Set(options.markets ?? (await marketsInUse(deps, options.signal)))
    // An unknown ref simply matches nothing: the command validated against the same registry, so
    // anything reaching here that does not match is a market this process cannot refresh.
    const markets = deps.markets.filter((ref) => requested.has(ref))

    if (options.scheduled !== true || markets.length === 0) {
      return await sweepMarkets(deps, markets, options)
    }

    return await deps.runScheduled({
      ...SCHEDULED_REFRESH,
      signal: options.signal,
      work: (run) => sweepMarkets(deps, markets, { ...options, ...run }),
    })
  }
}

async function sweepMarkets(
  deps: RefreshOperationDeps,
  markets: readonly MarketRef[],
  options: RefreshAllMarketDataOptions
): Promise<readonly RefreshMarketDataResult[]> {
  const now = Date.now()
  const results = await Promise.all(
    markets.map((market) =>
      deps.refresh({
        market,
        now,
        ...(options.forced === undefined ? {} : { forced: options.forced }),
        signal: options.signal,
        ...(options.progress === undefined ? {} : { progress: options.progress }),
      })
    )
  )

  logRefreshed(deps.logger, options.forced ?? false, results)

  return deps.recordTradeSides(results, options.signal)
}

/** Refreshing a market nobody reads costs only time; skipping one a holding reads leaves its stop
 *  unwatched. So a failed read of what is in use sweeps everything. */
async function marketsInUse(
  deps: RefreshOperationDeps,
  signal: AbortSignal
): Promise<ReadonlySet<MarketRef>> {
  try {
    return await deps.inUse(signal)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.markets_in_use_failed', { err: formatErrForLog(err) })

    return new Set(deps.markets)
  }
}

/** Every refresh leaves one line, degraded or not: what a kind decided — replaced, skipped as
 *  fresh, or fell short — is only answerable after the fact from a trace of the runs themselves. */
function logRefreshed(
  logger: Logger,
  forced: boolean,
  results: readonly RefreshMarketDataResult[]
): void {
  logger.info('trading.market_data_refreshed', {
    forced,
    markets: results.map((result) => ({
      market: result.market,
      elapsedMs: Math.round(result.elapsedMs),
      kinds: result.results.map(kindFields),
    })),
  })
}

function kindFields(result: RefreshKindResult): Record<string, string | number> {
  return {
    kind: result.kind,
    status: result.status,
    targetCount: result.targetCount,
    successfulTargetCount: result.successfulTargetCount,
    recordCount: result.recordCount,
    ...(result.elapsedMs === undefined ? {} : { elapsedMs: Math.round(result.elapsedMs) }),
  }
}

interface RefreshDegradation {
  readonly market: MarketRef
  readonly results: readonly RefreshKindResult[]
}

/** A warning degrades a kind whatever its status; a by-design note never does. */
export function refreshDegradations(
  results: readonly RefreshMarketDataResult[]
): readonly RefreshDegradation[] {
  return results.flatMap<RefreshDegradation>((result) => {
    const degraded = result.results.filter(isDegradedKind)

    return degraded.length === 0 ? [] : [{ market: result.market, results: degraded }]
  })
}

interface LogRefreshDegradationsOptions {
  readonly logger: Logger
  readonly forced: boolean
  readonly degradations: readonly RefreshDegradation[]
}

/** The sole `trading.market_data_refresh_degraded` call site: one cadence cannot report degradation
 *  in a shape the other does not. */
export function logRefreshDegradations(options: LogRefreshDegradationsOptions): void {
  options.logger.warn('trading.market_data_refresh_degraded', {
    forced: options.forced,
    markets: options.degradations.map((degradation) => ({
      market: degradation.market,
      kinds: degradation.results.map((result) => ({
        ...kindFields(result),
        caveats: result.caveats.map((caveat) => caveat.code),
      })),
    })),
  })
}

function isDegradedKind(result: RefreshKindResult): boolean {
  const warned = result.caveats.some((caveat) => caveatSeverity(caveat) === 'warn')

  return warned || DEGRADED_STATUSES.has(result.status)
}

async function runRefresh(
  deps: RefreshCoordinatorDeps,
  options: RefreshMarketDataOptions
): Promise<RefreshMarketDataResult> {
  const market = deps.markets.find(options.market)

  if (market === null) {
    throw new ValidationError(`market is not registered: ${options.market}`)
  }

  const startedTick = performance.now()
  const results = (await refreshMarketData(deps, market, options)).map(withStatusCaveats)
  const caveats = dedupeCaveats(results.flatMap((result) => result.caveats))

  if (results.some((result) => WRITING_STATUSES.has(result.status))) {
    await applyRetentionOrWarn(deps, market, options)
  }

  return {
    market: options.market,
    startedAt: options.now,
    dataThroughDay: resolveSettledDay(market.manifest.calendar, options.now),
    elapsedMs: Math.max(0, performance.now() - startedTick),
    results,
    caveats,
    anchors: refreshAnchorsForMarket(market, options.now),
  }
}

/** The pass already committed what it fetched, so a failed sweep is the next pass's to retry rather
 *  than a reason to report the refresh itself as failed. */
async function applyRetentionOrWarn(
  deps: RefreshCoordinatorDeps,
  market: Market,
  options: RefreshMarketDataOptions
): Promise<void> {
  try {
    await applyRetention(deps, market, options)
  } catch (err: unknown) {
    if (isAbortError(err) || options.signal.aborted) {
      throw err
    }

    deps.logger.warn('trading.market_data_retention_failed', {
      market: market.manifest.id,
      err: formatErrForLog(err),
    })
  }
}

/** A market with no population to replace publishes no `refresh` capability, so an empty result is
 *  the correct answer rather than a failure. */
async function refreshMarketData(
  deps: RefreshCoordinatorDeps,
  market: Market,
  options: RefreshMarketDataOptions
): Promise<readonly RefreshKindResult[]> {
  const capability = market.capabilities.refresh

  if (capability === undefined) {
    return []
  }

  return capability.run({
    limit: deps.universeLimit,
    asOf: market.manifest.calendar.dayAt(options.now),
    now: options.now,
    forced: options.forced ?? false,
    signal: options.signal,
    ...(options.progress === undefined ? {} : { progress: options.progress }),
  })
}

/** The status caveats are carried by the kind that earned them, so a surface renders them beside
 *  that row rather than in one market-level list a reader cannot attribute. The market aggregate
 *  stays the union of them. */
function withStatusCaveats(result: RefreshKindResult): RefreshKindResult {
  const added = [statusCaveat(result), missingTargetsCaveat(result)].filter(
    (caveat): caveat is Caveat => caveat !== null
  )

  return added.length === 0 ? result : { ...result, caveats: [...result.caveats, ...added] }
}

function statusCaveat(result: RefreshKindResult): Caveat | null {
  if (result.status === 'unavailable') {
    return { code: 'refresh.scope-empty', detail: { kind: result.kind } }
  }

  if (result.status === 'partial') {
    return {
      code: 'refresh.scope-partial',
      detail: {
        kind: result.kind,
        successfulTargetCount: result.successfulTargetCount,
        targetCount: result.targetCount,
      },
    }
  }

  if (result.status === 'retained') {
    return { code: 'refresh.previous-scope-kept', detail: { kind: result.kind } }
  }

  return null
}

/** The counts say how far a kind fell short; the names say which reads to look at. The overflow is
 *  its own list element, or the target it hangs off stops being one a renderer can put in a unit. */
function missingTargetsCaveat(result: RefreshKindResult): Caveat | null {
  if (result.missingTargets.length === 0) {
    return null
  }

  const shown = result.missingTargets.slice(0, MISSING_TARGET_SAMPLE)
  const hidden = result.missingTargets.length - shown.length
  const targets = hidden === 0 ? shown.join(', ') : `${shown.join(', ')}, +${hidden}`

  return { code: 'refresh.targets-missing', detail: { kind: result.kind, targets } }
}
