import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { BarRecord, FlowSnapshot, InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { MarketDeps } from '@/trading/markets/deps'
import type { CrossSection } from '@/trading/markets/equity-vn/factors/factors'
import type {
  MarketDayTotals,
  NameEvidence,
  NameEvidenceContext,
  NameReads,
  NameWindow,
} from '@/trading/markets/equity-vn/factors/name-evidence'
import type { MarketManifest } from '@/trading/markets/types'
import { abortError } from '@/core/errors'
import { flightCache } from '@/core/utils/concurrency'
import { loadSupervision } from '@/trading/markets/equity-vn/evidence/supervision'
import { buildCrossSection, VN_INDEX_INSTRUMENT } from '@/trading/markets/equity-vn/factors/factors'
import { readNameReads, toNameEvidence } from '@/trading/markets/equity-vn/factors/name-evidence'
import {
  ETF_BENCHMARK_BY_TICKER,
  VN_EVIDENCE_SESSIONS,
  VN_MARKET_REF,
  VN_MAX_EVIDENCE_LAG_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import { loadUniverse } from '@/trading/markets/equity-vn/refresh/universe'
import { addFlowTo } from '@/trading/markets/equity-vn/tape/flows'
import { addTurnoverTo } from '@/trading/markets/equity-vn/tape/session-totals'

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

  const freshFrom = manifest.calendar.addTradingDays(request.asOf, -VN_MAX_EVIDENCE_LAG_SESSIONS)
  const indexCandles = index.map((bar) => bar.candle)
  const { names, dayTotals } = await streamNames(deps, {
    universe,
    window,
    context: {
      asOf: request.asOf,
      freshFrom,
      supervision: supervision.levels,
      index: indexCandles,
      benchmarks,
      calendar: manifest.calendar,
      manifest,
    },
  })

  return buildCrossSection({
    universe,
    names,
    dayTotals,
    index: indexCandles,
    benchmarks,
    asOf: request.asOf,
    freshFrom,
    supervisionCoverage: supervision.coverage,
    caveats: supervision.caveats,
    calendar: manifest.calendar,
    annualAccounts,
    quarterlyAccounts,
  })
}

interface NamePass {
  readonly universe: readonly InstrumentRecord[]
  readonly window: NameWindow
  readonly context: NameEvidenceContext
}

/** The pass's own sums, local to one call so an aborted pass leaves nothing behind. */
interface PassTotals {
  readonly turnover: Map<TradingDay, number>
  readonly flows: Map<TradingDay, FlowSnapshot>
  newestFlow?: FlowSnapshot
}

/** One name at a time, in universe order: each name's bars and flows are reduced to its evidence and
 *  folded into the market's day totals before the next is read. The order is the answer too: float
 *  sums and the first flow's provenance read the names the way the universe lists them. */
async function streamNames(
  deps: MarketDeps,
  pass: NamePass
): Promise<{ readonly names: readonly NameEvidence[]; readonly dayTotals: MarketDayTotals }> {
  const { signal } = pass.window
  const totals: PassTotals = { turnover: new Map(), flows: new Map() }
  const names: NameEvidence[] = []

  for (const record of pass.universe) {
    if (record.kind !== 'equity' && record.kind !== 'etf') {
      continue
    }

    if (signal.aborted) {
      throw abortError(signal)
    }

    const reads = await readNameReads(deps, record, pass.window)

    addReadsTo(totals, reads)
    names.push(toNameEvidence(reads, pass.context))
  }

  return { names, dayTotals: totals }
}

function addReadsTo(totals: PassTotals, reads: NameReads): void {
  const { bars, flows } = reads

  addTurnoverTo(totals.turnover, bars)

  for (const flow of flows) {
    addFlowTo(totals.flows, flow)

    if (totals.newestFlow === undefined || flow.fetchedAt > totals.newestFlow.fetchedAt) {
      totals.newestFlow = flow
    }
  }
}

/** One read per distinct index, keyed by the index rather than the fund: several funds share VN30,
 *  and an index with no stored bars yet is simply absent, which the ETF factors read as abstain.
 *  Bars rather than candles, so a fund's factors cite the source of the series they read. */
async function loadBenchmarks(
  deps: MarketDeps,
  window: NameWindow
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

  return new Map(series.filter(([, bars]) => bars.length > 0))
}
