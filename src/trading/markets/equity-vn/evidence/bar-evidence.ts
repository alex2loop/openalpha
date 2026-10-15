import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, Ticker } from '@/trading/kernel/instrument'
import type { BarRecord } from '@/trading/kernel/market/market-data'
import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { BarWrite } from '@/trading/markets/bars'
import type { DayWindow } from '@/trading/markets/equity-vn/evidence/admissibility'
import type { EvidenceScope } from '@/trading/markets/equity-vn/evidence/evidence'
import type { TargetOutcome } from '@/trading/markets/refresh-result'
import type { TradingCalendar } from '@/trading/markets/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { createRefreshProgress } from '@/trading/kernel/market/refresh'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'
import { isRestated, RESTATEMENT_TAIL_SESSIONS } from '@/trading/markets/bar-restatement'
import { hasRebuiltWindow, writeBarWindows } from '@/trading/markets/bars'
import { buildPayloadRejectedCaveat, reportedCaveats } from '@/trading/markets/equity-vn/caveats'
import { admissibleCandles } from '@/trading/markets/equity-vn/evidence/admissibility'
import { invalidateWhenWritten, settledOnly } from '@/trading/markets/equity-vn/evidence/evidence'
import {
  resolveCoveredFrom,
  resolveFetchWindow,
} from '@/trading/markets/equity-vn/evidence/fetch-window'
import {
  VN_EVIDENCE_SESSIONS,
  VN_MARKET_REF,
  VN_SOURCE_CONCURRENCY,
} from '@/trading/markets/equity-vn/policy'
import {
  BOARD_KINDS,
  barTargets,
  seriesClass,
  tradeableTargets,
} from '@/trading/markets/equity-vn/refresh/targets'
import { MAXIMUM_NAMES_PER_LIST } from '@/trading/markets/overview-rollups'
import { buildRejectedOutcome, toKindResult } from '@/trading/markets/refresh-result'
import { INLINE_SEPARATOR } from '@/trading/render/layout'

/** Sessions per window when a name's whole history is fetched, sized to that same ceiling: one deep
 *  window is answered per name, a run of short ones for the whole board at once. */
const BACKFILL_CHUNK_SESSIONS = 20
/** Below this many names the backfill asks per name instead — a market-wide window costs the same
 *  pages whether one name needs it or all of them do. */
const BACKFILL_MINIMUM_TARGETS = 50

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
  const full = await fetchBackfill(scope, [
    ...window.rebuild,
    ...targets.filter((target) => restated.has(target.ticker)),
  ])
  // Judged on the deep window too, not only the tail: a forced pass rebuilds every name without a
  // tail, and naming none of them left old-basis plans behind history that now matched its source.
  // A window that did not come back keeps the basis it had, so its plans still describe the series.
  const rebuilt = full
    .filter((outcome) => isRestated(closes.get(outcome.instrument.ticker), outcome.value))
    .map((outcome) => outcome.instrument.ticker)

  return writeBars(
    scope,
    [
      ...tail
        .filter((outcome) => !restated.has(outcome.instrument.ticker))
        .map((outcome) => ({ outcome, fromDay: window.tailFromDay })),
      ...full.map((outcome) => ({ outcome, fromDay: scope.fromDay })),
    ],
    rebuilt
  )
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
): Promise<readonly TargetOutcome<readonly BarRecord[]>[]> {
  const window = { fromDay: scope.fromDay, toDay: scope.request.asOf }
  const board = new Set(
    tradeableTargets(scope.universe, BOARD_KINDS).map((target) => target.ticker)
  )
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
 *  provider for the same span and reads its slice of one market-wide answer. */
async function fetchChunkedBars(
  scope: EvidenceScope,
  targets: readonly InstrumentRef[],
  window: DayWindow
): Promise<readonly TargetOutcome<readonly BarRecord[]>[]> {
  const merged = new Map<Ticker, TargetOutcome<readonly BarRecord[]>>()

  for (const chunk of chunkWindows(scope.calendar, window)) {
    for (const outcome of await fetchAllBars(scope, targets, chunk)) {
      const held = merged.get(outcome.instrument.ticker)

      merged.set(
        outcome.instrument.ticker,
        held === undefined ? outcome : mergeChunk(held, outcome)
      )
    }
  }

  return [...merged.values()]
}

/** Oldest first, so the merged series is already in the order every reader expects. */
function chunkWindows(calendar: TradingCalendar, window: DayWindow): readonly DayWindow[] {
  const chunks: DayWindow[] = []
  let fromDay = window.fromDay

  while (fromDay <= window.toDay) {
    const step = calendar.addTradingDays(fromDay, BACKFILL_CHUNK_SESSIONS)
    const toDay = step > window.toDay ? window.toDay : step

    chunks.push({ fromDay, toDay })
    fromDay = calendar.addTradingDays(toDay, 1)
  }

  return chunks
}

/** A name survives only while every window answered for it: the write clears the whole span
 *  before writing, so a gap left by one failed window would erase history rather than leave it.
 *  The caller refetches the losers over the whole span instead. */
function mergeChunk(
  held: TargetOutcome<readonly BarRecord[]>,
  chunk: TargetOutcome<readonly BarRecord[]>
): TargetOutcome<readonly BarRecord[]> {
  const provenance = dedupeProvenance([...held.provenance, ...chunk.provenance])
  const caveats = dedupeCaveats([...held.caveats, ...chunk.caveats])

  if (held.value === undefined || chunk.value === undefined) {
    return { instrument: held.instrument, provenance, caveats }
  }

  return {
    instrument: held.instrument,
    value: [...held.value, ...chunk.value],
    provenance,
    caveats,
  }
}

function fetchAllBars(
  scope: EvidenceScope,
  targets: readonly InstrumentRef[],
  window: DayWindow
): Promise<readonly TargetOutcome<readonly BarRecord[]>[]> {
  const progress = createRefreshProgress(
    scope.request.progress,
    { market: VN_MARKET_REF, kind: 'bars' },
    targets.length
  )

  return mapWithConcurrency(targets, VN_SOURCE_CONCURRENCY, async (instrument) => {
    const outcome = await fetchBars(scope, instrument, window)

    progress.advance(1)

    return outcome
  })
}

async function fetchBars(
  scope: EvidenceScope,
  instrument: InstrumentRef,
  window: DayWindow
): Promise<TargetOutcome<readonly BarRecord[]>> {
  const result = await scope.deps.sources.resolve({
    kind: 'bars',
    context: {
      market: VN_MARKET_REF,
      instrument,
      ...seriesClass(scope.universe, instrument),
      ...window,
      limit: VN_EVIDENCE_SESSIONS,
    },
    signal: scope.request.signal,
  })

  if (result.kind === 'unavailable') {
    return buildRejectedOutcome(instrument, reportedCaveats(result.caveats, 'bars'))
  }

  const stamp = result.provenance[0]
  const candles = admissibleCandles(result.value, window)

  if (stamp === undefined || candles === null) {
    return buildRejectedOutcome(instrument, [
      ...result.caveats,
      buildPayloadRejectedCaveat(result.provenance, 'bars'),
    ])
  }

  return {
    instrument,
    value: settledOnly(candles, scope).map((candle) => ({
      sourceId: stamp.sourceId,
      fetchedAt: stamp.fetchedAt,
      instrument,
      candle,
      ...(candle.turnover === undefined ? {} : { turnover: candle.turnover }),
    })),
    provenance: result.provenance,
    caveats: result.caveats,
  }
}

/** Only a write reaching back to `scope.fromDay` rebuilt a name's history; a tail write caught it
 *  up. Both statuses are read by an operator, and one that says a full reload after a nightly
 *  catch-up describes a run that did not happen. */
async function writeBars(
  scope: EvidenceScope,
  writes: readonly BarWrite[],
  restatedTargets: readonly string[]
): Promise<RefreshKindResult> {
  const { recordCount, conflicted } = await writeBarWindows({
    deps: scope.deps,
    market: VN_MARKET_REF,
    toDay: scope.request.asOf,
    writes,
    signal: scope.request.signal,
  })

  invalidateWhenWritten(scope, recordCount)

  const refused = new Set<string>(conflicted.map((instrument) => instrument.ticker))

  return toKindResult({
    kind: 'bars',
    successStatus: hasRebuiltWindow(writes, scope.fromDay) ? 'replaced' : 'upserted',
    outcomes: writes.map((write) => write.outcome),
    recordCount,
    coveredFrom: resolveCoveredFrom(scope.storedFrom, scope.fromDay),
    // A refused write leaves the old bars standing, so the name is not one this pass rebuilt.
    restatedTargets: restatedTargets.filter((name) => !refused.has(name)),
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
