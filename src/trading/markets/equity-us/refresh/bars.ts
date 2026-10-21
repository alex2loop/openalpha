import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { BarRecord, Candle, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { DayWindow } from '@/trading/markets/admissibility'
import type { BarWrite } from '@/trading/markets/bars'
import type { MarketDeps } from '@/trading/markets/deps'
import type { TargetOutcome } from '@/trading/markets/refresh-result'
import type { MarketDataRefreshRequest, MarketManifest } from '@/trading/markets/types'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { sourcedCaveat } from '@/trading/kernel/caveat'
import { dedupeInstruments, ETF_KIND } from '@/trading/kernel/instrument'
import { createRefreshProgress } from '@/trading/kernel/market/refresh'
import { admissibleCandles } from '@/trading/markets/admissibility'
import { isRestated, RESTATEMENT_TAIL_SESSIONS } from '@/trading/markets/bar-restatement'
import { hasRebuiltWindow, writeBarWindows } from '@/trading/markets/bars'
import { isSettled } from '@/trading/markets/calendar'
import { loadUsMembers } from '@/trading/markets/equity-us/board'
import {
  US_EVIDENCE_SESSIONS,
  US_INDEX_TICKERS,
  US_MARKET_REF,
  US_RESTATEMENT_TOLERANCE,
  US_SCREEN_ETFS,
  US_SOURCE_CONCURRENCY,
} from '@/trading/markets/equity-us/policy'
import { resolveCoveredFrom, resolveFetchWindow } from '@/trading/markets/fetch-window'
import { MAXIMUM_NAMES_PER_LIST } from '@/trading/markets/overview-rollups'
import { buildRejectedOutcome, toKindResult } from '@/trading/markets/refresh-result'
import { INLINE_SEPARATOR } from '@/trading/render/layout'

interface BarsOptions {
  readonly manifest: MarketManifest
  readonly universe: readonly InstrumentRecord[]
  readonly request: MarketDataRefreshRequest
  /** The earliest session the last settled pass covered. */
  readonly storedFrom?: TradingDay
}

interface BarsPass extends BarsOptions {
  readonly deps: MarketDeps
  readonly historyFromDay: TradingDay
  readonly asOfSettled: boolean
}

type Fetched = readonly TargetOutcome<readonly BarRecord[]>[]

/** Board members, the fund board, the headline indices and the benchmark. A name the board does not
 *  hold is read on demand when asked about, so the refresh never fans out over the listing. */
export async function refreshUsBars(
  deps: MarketDeps,
  options: BarsOptions
): Promise<RefreshKindResult> {
  const { manifest, request } = options
  const pass: BarsPass = {
    ...options,
    deps,
    historyFromDay: manifest.calendar.addTradingDays(request.asOf, -US_EVIDENCE_SESSIONS),
    asOfSettled: isSettled(manifest.calendar, request.asOf, request.now),
  }
  const { tailFromDay, tail, full, rebuilt } = await fetchWindows(
    pass,
    await barTargets(deps, pass)
  )
  const restated = new Set<Ticker>(full.map((outcome) => outcome.instrument.ticker))

  return writeBars(
    pass,
    [
      ...tail
        .filter((outcome) => !restated.has(outcome.instrument.ticker))
        .map((outcome) => ({ outcome, fromDay: tailFromDay })),
      ...full.map((outcome) => ({ outcome, fromDay: pass.historyFromDay })),
    ],
    rebuilt
  )
}

interface FetchedWindows {
  readonly tailFromDay: TradingDay
  readonly tail: Fetched
  readonly full: Fetched
  /** Names the provider now publishes under different closes than the ones stored. */
  readonly rebuilt: readonly string[]
}

/** Names with current history re-ask a short tail, which also proves their stored closes still
 *  stand; a name whose tail came back changed, and every name too shallow to trust a tail, is
 *  refetched over the whole window. */
async function fetchWindows(
  pass: BarsPass,
  targets: readonly InstrumentRef[]
): Promise<FetchedWindows> {
  const { deps, request } = pass
  const window = resolveFetchWindow({
    calendar: pass.manifest.calendar,
    latestByTicker: await deps.marketDataStore.listLatestBars({
      market: US_MARKET_REF,
      signal: request.signal,
    }),
    targets,
    asOf: request.asOf,
    tailSessions: RESTATEMENT_TAIL_SESSIONS,
    historyFromDay: pass.historyFromDay,
    forced: request.forced,
    ...(pass.storedFrom === undefined ? {} : { storedFrom: pass.storedFrom }),
  })
  const rebuilding = new Set<Ticker>(window.rebuild.map((target) => target.ticker))
  const closes = await deps.marketDataStore.listBarCloses({
    market: US_MARKET_REF,
    fromDay: window.tailFromDay,
    signal: request.signal,
  })
  const isChanged = (outcome: TargetOutcome<readonly BarRecord[]>): boolean =>
    isRestated(closes.get(outcome.instrument.ticker), outcome.value, US_RESTATEMENT_TOLERANCE)
  const tail = await fetchAll(
    pass,
    targets.filter((target) => !rebuilding.has(target.ticker)),
    { fromDay: window.tailFromDay, toDay: request.asOf }
  )
  const changed = new Set<Ticker>(tail.filter(isChanged).map((o) => o.instrument.ticker))
  const full = await fetchAll(
    pass,
    [...window.rebuild, ...targets.filter((target) => changed.has(target.ticker))],
    { fromDay: pass.historyFromDay, toDay: request.asOf }
  )

  return {
    tailFromDay: window.tailFromDay,
    tail,
    full,
    // Judged on the deep window too: a forced pass rebuilds every name without a tail read.
    rebuilt: full.filter(isChanged).map((outcome) => outcome.instrument.ticker),
  }
}

async function barTargets(deps: MarketDeps, pass: BarsPass): Promise<readonly InstrumentRef[]> {
  const byRecord = new Map<Ticker, InstrumentRecord>(
    pass.universe.map((record) => [record.instrument.ticker, record])
  )
  const members = await loadUsMembers(deps, pass.manifest, {
    records: pass.universe,
    asOf: pass.request.asOf,
    now: pass.request.now,
    signal: pass.request.signal,
  })
  const funds = US_SCREEN_ETFS.flatMap((code) => {
    const record = byRecord.get(code)

    return record?.kind === ETF_KIND ? [record.instrument] : []
  })
  const indices = US_INDEX_TICKERS.flatMap((code) => {
    const record = byRecord.get(code)

    return record === undefined ? [] : [record.instrument]
  })

  return dedupeInstruments([
    ...members.map((member) => member.record.instrument),
    ...funds,
    ...indices,
  ])
}

function fetchAll(
  pass: BarsPass,
  targets: readonly InstrumentRef[],
  window: DayWindow
): Promise<Fetched> {
  const progress = createRefreshProgress(
    pass.request.progress,
    { market: US_MARKET_REF, kind: 'bars' },
    targets.length
  )

  return mapWithConcurrency(targets, US_SOURCE_CONCURRENCY, async (instrument) => {
    const outcome = await fetchBars(pass, instrument, window)

    progress.advance(1)

    return outcome
  })
}

async function fetchBars(
  pass: BarsPass,
  instrument: InstrumentRef,
  window: DayWindow
): Promise<TargetOutcome<readonly BarRecord[]>> {
  const kind = pass.universe.find((record) => record.instrument.ticker === instrument.ticker)?.kind
  const result = await pass.deps.sources.resolve({
    kind: 'bars',
    context: {
      market: US_MARKET_REF,
      instrument,
      ...(kind === undefined ? {} : { instrumentKind: kind }),
      ...window,
      limit: US_EVIDENCE_SESSIONS,
    },
    signal: pass.request.signal,
  })

  if (result.kind === 'unavailable') {
    return buildRejectedOutcome(instrument, result.caveats)
  }

  const stamp = result.provenance[0]
  const candles = admissibleCandles(result.value, window)

  if (stamp === undefined || candles === null) {
    return buildRejectedOutcome(instrument, [
      ...result.caveats,
      sourcedCaveat(
        'source.payload-rejected',
        result.provenance.map((p) => p.sourceId),
        {
          sourceKind: 'bars',
        }
      ),
    ])
  }

  return {
    instrument,
    value: settledRecords(pass, { instrument, candles, stamp }),
    provenance: result.provenance,
    caveats: result.caveats,
  }
}

/** A row stamped `asOf` while its session is still trading is forming, and forming rows are never
 *  stored. */
function settledRecords(
  pass: BarsPass,
  fetched: {
    readonly instrument: InstrumentRef
    readonly candles: readonly Candle[]
    readonly stamp: SourceProvenance
  }
): readonly BarRecord[] {
  const { instrument, candles, stamp } = fetched
  const settled = pass.asOfSettled
    ? candles
    : candles.filter((candle) => candle.at < pass.request.asOf)

  return settled.map((candle) => ({
    sourceId: stamp.sourceId,
    fetchedAt: stamp.fetchedAt,
    instrument,
    candle,
  }))
}

/** Only a write reaching back to the history depth rebuilt a name; a tail write caught it up. */
async function writeBars(
  pass: BarsPass,
  writes: readonly BarWrite[],
  restatedTargets: readonly string[]
): Promise<RefreshKindResult> {
  const { recordCount, conflicted } = await writeBarWindows({
    deps: pass.deps,
    market: US_MARKET_REF,
    toDay: pass.request.asOf,
    writes,
    signal: pass.request.signal,
  })
  const refused = new Set<string>(conflicted.map((instrument) => instrument.ticker))

  return toKindResult({
    kind: 'bars',
    successStatus: hasRebuiltWindow(writes, pass.historyFromDay) ? 'replaced' : 'upserted',
    outcomes: writes.map((write) => write.outcome),
    recordCount,
    coveredFrom: resolveCoveredFrom(pass.storedFrom, pass.historyFromDay),
    // A refused write leaves the old bars standing, so the name is not one this pass rebuilt.
    restatedTargets: restatedTargets.filter((name) => !refused.has(name)),
    caveats: basisConflictCaveats(conflicted),
  })
}

/** One caveat for the whole pass, never one per name: its old bars stand and the operator is told
 *  which names and how to rebuild them. */
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
