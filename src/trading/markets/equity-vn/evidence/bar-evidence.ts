import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { DayWindow } from '@/trading/markets/admissibility'
import type { BarWrite } from '@/trading/markets/bars'
import type { EvidenceScope } from '@/trading/markets/equity-vn/evidence/evidence'
import { isRestated, RESTATEMENT_TAIL_SESSIONS } from '@/trading/markets/bar-restatement'
import { hasRebuiltWindow, writeBarWindows } from '@/trading/markets/bars'
import {
  BACKFILL_MINIMUM_TARGETS,
  type BarOutcome,
  boardTickers,
  chunkWindows,
  fetchAllBars,
  fullWindow,
  joinOutcomes,
} from '@/trading/markets/equity-vn/evidence/bar-fetch'
import {
  fetchPagedHistory,
  splitInitialHistory,
} from '@/trading/markets/equity-vn/evidence/bar-paged'
import { invalidateWhenWritten } from '@/trading/markets/equity-vn/evidence/evidence'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { barTargets } from '@/trading/markets/equity-vn/refresh/targets'
import { resolveCoveredFrom, resolveFetchWindow } from '@/trading/markets/fetch-window'
import { MAXIMUM_NAMES_PER_LIST } from '@/trading/markets/overview-rollups'
import { toKindResult } from '@/trading/markets/refresh-result'
import { INLINE_SEPARATOR } from '@/trading/render/layout'

interface BackfillInput {
  readonly rebuild: readonly InstrumentRef[]
  /** Names the tail showed restated: refetched whole, never paged. */
  readonly repeat: readonly InstrumentRef[]
  readonly closes: ReadonlyMap<Ticker, ReadonlyMap<TradingDay, number>>
}

/** What a pass tells the write beside its windows: the names the provider re-adjusted, and the rows
 *  the paged windows already wrote. */
interface BarTally {
  readonly restated: readonly string[]
  readonly writtenCount: number
}

/** Every instrument whose price series a factor reads, plus the reference legs the index and basis
 *  views need. Two passes: one shared tail window the provider answers market-wide, then the full
 *  window for the names that have no history reaching it and the ones it just proved restated. */
export async function refreshBars(scope: EvidenceScope): Promise<RefreshKindResult> {
  const targets = barTargets(scope.universe, scope.repairTargets)
  const latest = await scope.deps.marketDataStore.listLatestBars({
    market: VN_MARKET_REF,
    signal: scope.request.signal,
  })
  const window = resolveFetchWindow({
    calendar: scope.calendar,
    latestByTicker: latest,
    targets,
    asOf: scope.request.asOf,
    tailSessions: RESTATEMENT_TAIL_SESSIONS,
    historyFromDay: scope.fromDay,
    forced: scope.request.forced,
    ...(scope.storedFrom === undefined ? {} : { storedFrom: scope.storedFrom }),
  })

  // Matched on ticker, never object identity: `barTargets` runs its list through
  // `dedupeInstruments`, which is free to return new objects.
  const rebuilding = new Set(window.rebuild.map((target) => target.ticker))
  const closes = await scope.deps.marketDataStore.listBarCloses({
    market: VN_MARKET_REF,
    fromDay: window.tailFromDay,
    signal: scope.request.signal,
  })

  const tail = await fetchAllBars(
    scope,
    targets.filter((target) => !rebuilding.has(target.ticker)),
    { fromDay: window.tailFromDay, toDay: scope.request.asOf }
  )
  const restated = new Set(
    tail
      .filter((outcome) => isRestated(closes.get(outcome.instrument.ticker), outcome.value))
      .map((outcome) => outcome.instrument.ticker)
  )

  const back = await backfillHistory(scope, {
    rebuild: window.rebuild,
    repeat: targets.filter((target) => restated.has(target.ticker)),
    closes,
  })

  return writeBars(
    scope,
    [
      ...tail
        .filter((outcome) => !restated.has(outcome.instrument.ticker))
        .map((outcome) => ({ outcome, fromDay: window.tailFromDay })),
      ...back.writes,
    ],
    back.tally
  )
}

async function backfillHistory(
  scope: EvidenceScope,
  input: BackfillInput
): Promise<{ readonly writes: readonly BarWrite[]; readonly tally: BarTally }> {
  const { initial, rest } = splitInitialHistory(scope, input.rebuild)
  const paged = await fetchPagedHistory(scope, initial)
  const full = await fetchBackfill(scope, [...rest, ...input.repeat])

  // Judged on the deep window too, not only the tail: a forced pass rebuilds every name without a
  // tail, and naming none of them left old-basis plans behind history that now matched its source.
  // A window that did not come back keeps the basis it had, so its plans still describe the series.
  const restated = full
    .filter((outcome) => isRestated(input.closes.get(outcome.instrument.ticker), outcome.value))
    .map((outcome) => outcome.instrument.ticker)

  return {
    writes: [...full, ...paged.outcomes].map((outcome) => ({ outcome, fromDay: scope.fromDay })),
    tally: { restated, writtenCount: paged.recordCount },
  }
}

/** One deep window is a request per name; a run of short ones is a few paged reads the whole board
 *  shares. Under the minimum that inverts, so a repair of a handful of names still asks per name.
 *
 *  Only board listings share those windows, and only while every window answers for them. The legs
 *  are quoted one at a time, and a name listed part-way through the history has no rows in the
 *  windows before it — which reads as an unavailable window, not an empty one. Both take the single
 *  deep request they would have taken anyway. */
async function fetchBackfill(
  scope: EvidenceScope,
  targets: readonly InstrumentRef[]
): Promise<readonly BarOutcome[]> {
  const window = fullWindow(scope)
  const board = boardTickers(scope)
  const shared = targets.filter((target) => board.has(target.ticker))

  if (shared.length < BACKFILL_MINIMUM_TARGETS) {
    return fetchAllBars(scope, targets, window)
  }

  const chunked = await fetchChunkedBars(scope, shared, window)
  const single = [
    ...targets.filter((target) => !board.has(target.ticker)),
    ...chunked
      .filter((outcome) => outcome.value === undefined)
      .map((outcome) => outcome.instrument),
  ]

  return [
    ...chunked.filter((outcome) => outcome.value !== undefined),
    ...(await fetchAllBars(scope, single, window)),
  ]
}

/** Windows run in sequence and names inside them concurrently, so every name in a pass asks the
 *  provider for the same span and reads its slice of one market-wide answer. A name survives only
 *  while every window answered for it: the write clears the whole span before writing, so a gap
 *  left by one failed window would erase history rather than leave it. The caller refetches the
 *  losers over the whole span instead. */
async function fetchChunkedBars(
  scope: EvidenceScope,
  targets: readonly InstrumentRef[],
  window: DayWindow
): Promise<readonly BarOutcome[]> {
  const merged = new Map<Ticker, BarOutcome>()

  for (const chunk of chunkWindows(scope.calendar, window)) {
    for (const outcome of await fetchAllBars(scope, targets, chunk)) {
      const held = merged.get(outcome.instrument.ticker)

      merged.set(
        outcome.instrument.ticker,
        held === undefined ? outcome : joinOutcomes(held, outcome, (all, next) => [...all, ...next])
      )
    }
  }

  return [...merged.values()]
}

/** Only a write reaching back to `scope.fromDay` rebuilt a name's history; a tail write caught it
 *  up. Both statuses are read by an operator, and one that says a full reload after a nightly
 *  catch-up describes a run that did not happen. */
async function writeBars(
  scope: EvidenceScope,
  writes: readonly BarWrite[],
  tally: BarTally
): Promise<RefreshKindResult> {
  const { recordCount: finalCount, conflicted } = await writeBarWindows({
    deps: scope.deps,
    market: VN_MARKET_REF,
    toDay: scope.request.asOf,
    writes,
    signal: scope.request.signal,
  })

  const recordCount = finalCount + tally.writtenCount

  invalidateWhenWritten(scope, recordCount)

  const refused = new Set<string>(conflicted.map((instrument) => instrument.ticker))

  return toKindResult({
    kind: 'bars',
    successStatus: hasRebuiltWindow(writes, scope.fromDay) ? 'replaced' : 'upserted',
    outcomes: writes.map((write) => write.outcome),
    recordCount,
    coveredFrom: resolveCoveredFrom(scope.storedFrom, scope.fromDay),
    // A refused write leaves the old bars standing, so the name is not one this pass rebuilt.
    restatedTargets: tally.restated.filter((name) => !refused.has(name)),
    caveats: basisConflictCaveats(conflicted),
  })
}

/** One caveat for the whole pass, never one per name: only vndirect publishes adjusted VN bars, so a
 *  name that failed over to entrade or vietcap brought a raw series the stored history cannot be
 *  joined to. Its old bars stand; the operator is told which names and how to rebuild them. */
function basisConflictCaveats(conflicted: readonly InstrumentRef[]): readonly Caveat[] {
  if (conflicted.length === 0) {
    return []
  }

  return [
    {
      code: 'market-data.bar-basis-conflict',
      detail: {
        count: conflicted.length,
        tickers: conflicted
          .slice(0, MAXIMUM_NAMES_PER_LIST)
          .map((instrument) => instrument.ticker)
          .join(INLINE_SEPARATOR),
      },
    },
  ]
}
