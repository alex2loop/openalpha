import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { BarRecord, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { MarketDeps } from '@/trading/markets/deps'
import type {
  CrossSection,
  NameEvidence,
  NameReads,
  StableInputs,
} from '@/trading/markets/equity-vn/factors/factors'
import type { MarketManifest } from '@/trading/markets/types'
import { flightCache, mapWithConcurrency } from '@/core/utils/concurrency'
import { loadSupervision } from '@/trading/markets/equity-vn/evidence/supervision'
import {
  assembleCrossSection,
  buildDayInputs,
  evidenceOf,
  tradeableNames,
  VN_INDEX_INSTRUMENT,
} from '@/trading/markets/equity-vn/factors/factors'
import {
  ETF_BENCHMARK_BY_TICKER,
  VN_EVIDENCE_SESSIONS,
  VN_MARKET_REF,
} from '@/trading/markets/equity-vn/policy'
import { loadUniverse } from '@/trading/markets/equity-vn/refresh/universe'

const CROSS_SECTION_CACHE_DAYS = 2
const EVIDENCE_CONCURRENCY = 8

export interface CrossSectionCache {
  get(asOf: TradingDay, signal: AbortSignal): Promise<CrossSection>
  /** The pass for `day`, the session right before `asOf`: cut from the `asOf` pass when it is held,
   *  a full pass of its own otherwise, so a miss costs memory and never a different board. */
  getBefore(asOf: TradingDay, day: TradingDay, signal: AbortSignal): Promise<CrossSection>
  /** Refresh calls this after writing evidence; nothing else invalidates. */
  invalidate(): void
}

/** One population pass per day, shared by the screen, the factors, and the macro confirmers: a
 *  batch calls this concurrently for every name, and one pass answers all of them. Two slots, so a
 *  screen at another day does not evict the day a brief is describing. */
export function crossSectionCache(deps: MarketDeps, manifest: MarketManifest): CrossSectionCache {
  const passes = flightCache<CrossSection>(CROSS_SECTION_CACHE_DAYS)
  const get: CrossSectionCache['get'] = (asOf, signal) =>
    passes.share(asOf, signal, () => loadCrossSection(deps, manifest, { asOf, signal }))

  return {
    get,
    getBefore: async (asOf, day, signal) => {
      const held = passes.peek(asOf)

      if (held === undefined || manifest.calendar.addTradingDays(asOf, -1) !== day) {
        return get(day, signal)
      }

      return buildCrossSectionAt(deps, await held, { day, signal })
    },
    invalidate: passes.clear,
  }
}

interface DayRequest {
  readonly day: TradingDay
  readonly signal: AbortSignal
}

/** A full pass: everything read from the store for `request.asOf`. */
async function loadCrossSection(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: { readonly asOf: TradingDay; readonly signal: AbortSignal }
): Promise<CrossSection> {
  const { asOf, signal } = request
  const stable = await readStableInputs(deps, manifest, signal)
  const window = {
    fromDay: manifest.calendar.addTradingDays(asOf, -VN_EVIDENCE_SESSIONS),
    toDay: asOf,
    signal,
  }
  const [index, benchmarks, names] = await Promise.all([
    deps.marketDataStore.listBars({ instrument: VN_INDEX_INSTRUMENT, ...window }),
    loadBenchmarks(deps, window),
    mapWithConcurrency(tradeableNames(stable.universe), EVIDENCE_CONCURRENCY, async (record) =>
      evidenceOf(await readNameReads(deps, record, window), stable, asOf)
    ),
  ])
  const day = buildDayInputs(stable.calendar, asOf, {
    index: index.map((bar) => bar.candle),
    benchmarks,
    names,
  })

  return assembleCrossSection(stable, day)
}

/** An earlier day's pass cut from a later one: every series stops at `day`, and the gates, ranks and
 *  roll-ups are worked again over what is left, because a rank is only true inside its population.
 *  It differs from a fresh pass for `day` only by the one oldest session its window no longer holds. */
async function buildCrossSectionAt(
  deps: MarketDeps,
  base: CrossSection,
  request: DayRequest
): Promise<CrossSection> {
  const { day } = request
  const names = await mapWithConcurrency(base.names, EVIDENCE_CONCURRENCY, async (name) =>
    evidenceOf(await cutNameReads(deps, name, request), base.stable, day)
  )
  const inputs = buildDayInputs(base.stable.calendar, day, {
    index: base.indexBars.filter((candle) => candle.at <= day),
    benchmarks: new Map(
      [...base.benchmarks].map(([code, bars]) => [code, bars.filter((bar) => bar.candle.at <= day)])
    ),
    names,
  })

  return assembleCrossSection(base.stable, inputs)
}

async function readStableInputs(
  deps: MarketDeps,
  manifest: MarketManifest,
  signal: AbortSignal
): Promise<StableInputs> {
  const universe = await loadUniverse(deps, { signal })
  const [supervision, annualAccounts, quarterlyAccounts] = await Promise.all([
    loadSupervision(deps, { signal }),
    deps.marketDataStore.listAnnualAccounts({ market: VN_MARKET_REF, signal }),
    deps.marketDataStore.listQuarterlyAccounts({ market: VN_MARKET_REF, signal }),
  ])

  return {
    universe,
    supervision: supervision.levels,
    supervisionCoverage: supervision.coverage,
    caveats: supervision.caveats,
    calendar: manifest.calendar,
    annualAccounts,
    quarterlyAccounts,
  }
}

interface SeriesWindow {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
  readonly signal: AbortSignal
}

async function readNameReads(
  deps: MarketDeps,
  record: InstrumentRecord,
  window: SeriesWindow
): Promise<NameReads> {
  const read = { instrument: record.instrument, ...window }
  const [bars, flows, fundamental] = await Promise.all([
    deps.marketDataStore.listBars(read),
    deps.marketDataStore.listFlows(read),
    deps.marketDataStore.findLatestFundamental({
      instrument: record.instrument,
      asOf: window.toDay,
      signal: window.signal,
    }),
  ])

  return { record, bars, flows, fundamental }
}

/** The stored fundamental stands for `day` only if it was published by then; a name whose latest
 *  snapshot is newer is asked again, the question a fresh pass for `day` asks. */
async function cutNameReads(
  deps: MarketDeps,
  name: NameEvidence,
  request: DayRequest
): Promise<NameReads> {
  const { day, signal } = request
  const { record, fundamental } = name
  const current =
    fundamental !== null && fundamental.asOf > day
      ? await deps.marketDataStore.findLatestFundamental({
          instrument: record.instrument,
          asOf: day,
          signal,
        })
      : fundamental

  return {
    record,
    bars: name.bars.filter((bar) => bar.candle.at <= day),
    flows: name.flows.filter((flow) => flow.at <= day),
    fundamental: current,
  }
}

/** One read per distinct index, keyed by the index rather than the fund: several funds share VN30.
 *  Bars rather than candles, so a fund's factors cite the source of the series they read. */
async function loadBenchmarks(
  deps: MarketDeps,
  window: SeriesWindow
): Promise<ReadonlyMap<Ticker, readonly BarRecord[]>> {
  const indices = [...new Set(ETF_BENCHMARK_BY_TICKER.values())]
  const series = await Promise.all(
    indices.map(async (code) => {
      const bars = await deps.marketDataStore.listBars({
        instrument: { market: VN_MARKET_REF, ticker: code },
        ...window,
      })

      return [code, bars] as const
    })
  )

  return new Map(series)
}
