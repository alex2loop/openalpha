import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { MarketDeps } from '@/trading/markets/deps'
import type { CrossSection } from '@/trading/markets/equity-vn/factors/factors'
import type { MarketManifest } from '@/trading/markets/types'
import { flightCache } from '@/core/utils/concurrency'
import { loadSupervision } from '@/trading/markets/equity-vn/evidence/supervision'
import { buildCrossSection, VN_INDEX_INSTRUMENT } from '@/trading/markets/equity-vn/factors/factors'
import {
  ETF_BENCHMARK_BY_TICKER,
  VN_EVIDENCE_SESSIONS,
  VN_MARKET_REF,
  VN_MAX_EVIDENCE_LAG_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import { loadUniverse } from '@/trading/markets/equity-vn/refresh/universe'

const CROSS_SECTION_CACHE_DAYS = 2

export interface CrossSectionCache {
  get(asOf: TradingDay, signal: AbortSignal): Promise<CrossSection>
  /** Refresh calls this after writing evidence; nothing else invalidates. */
  invalidate(): void
}

/** One population pass per day, shared by the screen, the factors, and the macro confirmers: a
 *  batch calls this concurrently for every name, and one pass answers all of them. Two slots, so
 *  yesterday's brief pass and today's screen pass coexist — the brief's delta needs the prior day
 *  without evicting the day it is describing. */
export function crossSectionCache(deps: MarketDeps, manifest: MarketManifest): CrossSectionCache {
  const passes = flightCache<CrossSection>(CROSS_SECTION_CACHE_DAYS)

  return {
    get: (asOf, signal) =>
      passes.share(asOf, signal, () => loadCrossSection(deps, manifest, { asOf, signal })),
    invalidate: passes.clear,
  }
}

interface CrossSectionRequest {
  readonly asOf: TradingDay
  readonly signal: AbortSignal
}

async function loadCrossSection(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: CrossSectionRequest
): Promise<CrossSection> {
  const fromDay = manifest.calendar.addTradingDays(request.asOf, -VN_EVIDENCE_SESSIONS)
  const window = { fromDay, toDay: request.asOf, signal: request.signal }
  const universe = await loadUniverse(deps, { signal: request.signal })
  const [index, benchmarks, supervision, annualAccounts, quarterlyAccounts] = await Promise.all([
    deps.marketDataStore.listBars({ instrument: VN_INDEX_INSTRUMENT, ...window }),
    loadBenchmarks(deps, window),
    loadSupervision(deps, { signal: request.signal }),
    deps.marketDataStore.listAnnualAccounts({ market: VN_MARKET_REF, signal: request.signal }),
    deps.marketDataStore.listQuarterlyAccounts({ market: VN_MARKET_REF, signal: request.signal }),
  ])

  return buildCrossSection(deps, {
    universe,
    index: index.map((bar) => bar.candle),
    benchmarks,
    asOf: request.asOf,
    freshFrom: manifest.calendar.addTradingDays(request.asOf, -VN_MAX_EVIDENCE_LAG_SESSIONS),
    fromDay,
    supervision: supervision.levels,
    supervisionCoverage: supervision.coverage,
    caveats: supervision.caveats,
    calendar: manifest.calendar,
    annualAccounts,
    quarterlyAccounts,
    signal: request.signal,
  })
}

interface SeriesWindow {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
  readonly signal: AbortSignal
}

/** One read per distinct index, keyed by the index rather than the fund: several funds share VN30,
 *  and an index with no stored bars yet is simply absent, which the ETF factors read as abstain. */
async function loadBenchmarks(
  deps: MarketDeps,
  window: SeriesWindow
): Promise<ReadonlyMap<Ticker, readonly Candle[]>> {
  const indices = [...new Set(ETF_BENCHMARK_BY_TICKER.values())]
  const series = await Promise.all(
    indices.map(async (code) => {
      const bars = await deps.marketDataStore.listBars({
        instrument: { market: VN_MARKET_REF, ticker: code },
        ...window,
      })

      return [code, bars.map((bar) => bar.candle)] as const
    })
  )

  return new Map(series.filter(([, candles]) => candles.length > 0))
}
