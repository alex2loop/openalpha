import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { MarketCapRecord } from '@/trading/kernel/market/market-data'
import type { MarketRefreshAttempt, RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { VenueListing } from '@/trading/kernel/venue/catalog'
import type { BarWrite } from '@/trading/markets/bars'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketDataRefreshRequest, MarketManifest } from '@/trading/markets/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { dedupeInstruments } from '@/trading/kernel/instrument'
import { createRefreshProgress } from '@/trading/kernel/market/refresh'
import { hasRebuiltWindow, writeBarWindows } from '@/trading/markets/bars'
import { resolveSettledDay } from '@/trading/markets/calendar'
import {
  BTC_TICKER,
  CRYPTO_MARKET_REF,
  CRYPTO_REPAIR_COOLDOWN_MS,
  CRYPTO_SOURCE_CONCURRENCY,
} from '@/trading/markets/crypto/policy'
import {
  examinedRows,
  isEligibleUniverseRow,
  loadUniverseBoard,
  shallowBoardCaveats,
} from '@/trading/markets/crypto/universe'
import { longestBarWindow } from '@/trading/markets/levels'
import {
  buildRejectedOutcome,
  buildReplayedResult,
  emptyKindResult,
  toKindResult,
} from '@/trading/markets/refresh-result'
import { partitionByVenueListing } from '@/trading/markets/screen-partition'

interface RefreshScope {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  readonly request: MarketDataRefreshRequest
  readonly settled: TradingDay
  readonly targets: readonly InstrumentRef[]
  /** What reading the board cost. A sweep that fell to a shallower provider plans over a fraction
   *  of the field, which every count this pass reports would otherwise describe as the whole. */
  readonly boardCaveats: readonly Caveat[]
}

type RepairContext = Omit<RefreshScope, 'targets' | 'boardCaveats'>

interface BarPlan {
  readonly instrument: InstrumentRef
  readonly fromDay: TradingDay
}

export async function refreshCrypto(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: MarketDataRefreshRequest
): Promise<readonly RefreshKindResult[]> {
  const settled = resolveSettledDay(manifest.calendar, request.now)
  const attempts = await deps.marketDataStore.listRefreshAttempts({
    market: CRYPTO_MARKET_REF,
    signal: request.signal,
  })
  const covered = findCoveredAttempt(attempts, settled)

  if (covered !== null && !request.forced) {
    return [await repairBars({ deps, manifest, request, settled }, covered)]
  }

  const [universe, listing] = await Promise.all([
    loadUniverseBoard(deps, request.signal),
    deps.venueListings.readListing(CRYPTO_MARKET_REF, request.signal),
  ])

  if (universe.kind === 'unavailable') {
    return [emptyKindResult('bars', 'unavailable', universe.caveats)]
  }

  const scope: RefreshScope = {
    deps,
    manifest,
    request,
    settled,
    targets: refreshTargets(universe.value, listing),
    boardCaveats: boardCaveatsOf(universe.caveats, universe.value),
  }

  return [await settleAttempt(scope, await refreshBars(scope))]
}

function findCoveredAttempt(
  attempts: readonly MarketRefreshAttempt[],
  settled: TradingDay
): MarketRefreshAttempt | null {
  return (
    attempts.find((attempt) => attempt.result.kind === 'bars' && attempt.asOf === settled) ?? null
  )
}

/** A covered pass covers only the names it reached: the ones it lost are asked for again on their
 *  own, so a handful of failed reads do not pin the board until the next session. The cooldown is
 *  what keeps a name no provider serves from refetching on every command. */
async function repairBars(
  context: RepairContext,
  attempt: MarketRefreshAttempt
): Promise<RefreshKindResult> {
  const stored = attempt.result
  const replayed = buildReplayedResult(stored, stored.recordCount)

  if (
    stored.missingTargets.length === 0 ||
    context.request.now - attempt.attemptedAt < CRYPTO_REPAIR_COOLDOWN_MS
  ) {
    return replayed
  }

  const scope = await buildRepairScope(context, new Set(stored.missingTargets))

  if (scope === null) {
    return replayed
  }

  const retried = await refreshBars(scope)

  // A name the board no longer carries leaves the repair with nothing to attempt, and an empty
  // attempt says nothing about the stored population.
  return retried.targetCount === 0
    ? replayed
    : await settleAttempt(scope, mergeRepaired(stored, retried))
}

/** Null where the repair has nothing to run: the board could not be read, or none of the lost names
 *  are on it any more. */
async function buildRepairScope(
  context: RepairContext,
  missing: ReadonlySet<string>
): Promise<RefreshScope | null> {
  const [universe, listing] = await Promise.all([
    loadUniverseBoard(context.deps, context.request.signal),
    context.deps.venueListings.readListing(CRYPTO_MARKET_REF, context.request.signal),
  ])

  if (universe.kind === 'unavailable') {
    return null
  }

  const targets = refreshTargets(universe.value, listing).filter((target) =>
    missing.has(target.ticker)
  )

  return targets.length === 0
    ? null
    : { ...context, targets, boardCaveats: boardCaveatsOf(universe.caveats, universe.value) }
}

/** Both what the providers said while the board was read and what the board itself turned out to
 *  be: a failover that answered is not an error, and neither is visible in the rows. */
function boardCaveatsOf(
  read: readonly Caveat[],
  records: readonly MarketCapRecord[]
): readonly Caveat[] {
  return dedupeCaveats([...read, ...shallowBoardCaveats(records)])
}

/** Coverage is counted by name, not by sum: the repair attempted a subset, so its own counts stand
 *  for that subset alone. A repair that recovered nothing leaves the population where it was. */
function mergeRepaired(covered: RefreshKindResult, retried: RefreshKindResult): RefreshKindResult {
  const stillMissing = new Set(retried.missingTargets)
  const missingTargets = covered.missingTargets.filter((ticker) => stillMissing.has(ticker))
  const recovered = covered.missingTargets.length - missingTargets.length

  return {
    kind: 'bars',
    status: missingTargets.length === 0 ? retried.status : 'partial',
    targetCount: covered.targetCount,
    successfulTargetCount: covered.targetCount - missingTargets.length,
    missingTargets,
    recordCount: recovered === 0 ? covered.recordCount : covered.recordCount + retried.recordCount,
    ...(covered.coveredFrom === undefined ? {} : { coveredFrom: covered.coveredFrom }),
    provenance: retried.provenance,
    caveats: retried.caveats,
  }
}

/** A zero-target pass attempted nothing, so it says nothing about the stored population and writes
 *  no row. */
async function settleAttempt(
  scope: RefreshScope,
  result: RefreshKindResult
): Promise<RefreshKindResult> {
  if (result.targetCount === 0) {
    return result
  }

  await scope.deps.marketDataStore.upsertRefreshAttempt(
    {
      market: CRYPTO_MARKET_REF,
      asOf: scope.settled,
      attemptedAt: scope.request.now,
      result,
    },
    scope.request.signal
  )

  return result
}

/** What a run will actually read, plus BTC, whose regime window every candidate scores against. A
 *  name outside the examined set is not here and needs no row: its read falls through to the
 *  provider, which is the right answer for one no screen was going to score.
 *
 *  Gated on the venue listing before the evidence budget, the order the screen applies it in: the
 *  two sets have to be the one set, and a name gated there but examined here takes the slot of a
 *  reachable one, which is then scored with no bars behind it. */
function refreshTargets(
  rows: readonly MarketCapRecord[],
  listing: VenueListing
): readonly InstrumentRef[] {
  const eligible = rows.filter(isEligibleUniverseRow)
  const reachable = partitionByVenueListing(eligible, listing, (row) => row.priceUsd)

  return dedupeInstruments([
    { market: CRYPTO_MARKET_REF, ticker: BTC_TICKER },
    ...examinedRows(reachable.survivors).map((row) => row.instrument),
  ])
}

/** Each name fetches only what its stored series lacks: the tail past its newest day, or the whole
 *  history window when nothing reaches it. A forced pass rebuilds every name. */
async function refreshBars(scope: RefreshScope): Promise<RefreshKindResult> {
  const { deps, manifest, request, settled } = scope
  const sessions = longestBarWindow(manifest.evidenceSessions)
  const historyFrom = manifest.calendar.addTradingDays(settled, -sessions)
  const latest = await deps.marketDataStore.listLatestBars({
    market: CRYPTO_MARKET_REF,
    signal: request.signal,
  })
  const plans = scope.targets.flatMap((instrument): readonly BarPlan[] => {
    const newest = request.forced ? undefined : latest.get(instrument.ticker)?.day
    const fromDay =
      newest === undefined || newest < historyFrom
        ? historyFrom
        : manifest.calendar.addTradingDays(newest, 1)

    return fromDay > settled ? [] : [{ instrument, fromDay }]
  })

  if (plans.length === 0) {
    return emptyKindResult('bars', 'fresh', scope.boardCaveats)
  }

  const progress = createRefreshProgress(
    scope.request.progress,
    { market: CRYPTO_MARKET_REF, kind: 'bars' },
    plans.length
  )
  const writes = await mapWithConcurrency(plans, CRYPTO_SOURCE_CONCURRENCY, async (plan) => {
    const write = await fetchBars(scope, plan)

    progress.advance(1)

    return write
  })
  const { recordCount } = await writeBarWindows({
    deps,
    market: CRYPTO_MARKET_REF,
    toDay: settled,
    writes,
    signal: request.signal,
  })

  return toKindResult({
    kind: 'bars',
    successStatus: hasRebuiltWindow(writes, historyFrom) ? 'replaced' : 'upserted',
    outcomes: writes.map((write) => write.outcome),
    recordCount,
    coveredFrom: historyFrom,
    caveats: scope.boardCaveats,
  })
}

async function fetchBars(scope: RefreshScope, plan: BarPlan): Promise<BarWrite> {
  const { deps, request, settled } = scope
  const result = await deps.sources.resolve({
    kind: 'bars',
    context: {
      market: CRYPTO_MARKET_REF,
      instrument: plan.instrument,
      fromDay: plan.fromDay,
      toDay: settled,
    },
    signal: request.signal,
  })
  const stamp = result.kind === 'available' ? result.provenance[0] : undefined

  if (result.kind === 'unavailable' || stamp === undefined) {
    return { outcome: buildRejectedOutcome(plan.instrument, result.caveats), fromDay: plan.fromDay }
  }

  const records = result.value
    .filter((candle) => candle.at >= plan.fromDay && candle.at <= settled)
    .map((candle) => ({
      sourceId: stamp.sourceId,
      fetchedAt: stamp.fetchedAt,
      instrument: plan.instrument,
      candle,
      ...(candle.turnover === undefined ? {} : { turnover: candle.turnover }),
    }))

  if (records.length === 0) {
    return { outcome: buildRejectedOutcome(plan.instrument, result.caveats), fromDay: plan.fromDay }
  }

  return {
    outcome: {
      instrument: plan.instrument,
      value: records,
      provenance: result.provenance,
      caveats: result.caveats,
    },
    fromDay: plan.fromDay,
  }
}
