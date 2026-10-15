import type {
  CurrencyCode,
  InstrumentRef,
  PortfolioSegment,
  TradingDay,
} from '@/trading/kernel/instrument'

export const NAV_WINDOWS = Object.freeze(['1m', '3m', '6m', '1y', 'all'] as const)
export type NavWindow = (typeof NAV_WINDOWS)[number]
export const DEFAULT_NAV_WINDOW: NavWindow = '3m'
/** Why a history carries no benchmark: no target segment has one, or a leg's closes do not span
 *  the window. */
export const BENCHMARK_GAPS = Object.freeze(['unbenchmarked', 'short-history'] as const)
type BenchmarkGap = (typeof BENCHMARK_GAPS)[number]
/** Calendar days per window; `all` has no lower bound. */
export const NAV_WINDOW_DAYS: Readonly<Record<Exclude<NavWindow, 'all'>, number>> = Object.freeze({
  '1m': 30,
  '3m': 91,
  '6m': 182,
  '1y': 365,
})

export interface NavSnapshot {
  readonly day: TradingDay
  readonly baseCurrency: CurrencyCode
  readonly navBase: number
  readonly cashBase: number
  readonly netDepositsBase: number
  readonly recordedAt: number
}

export interface NavSnapshotStore {
  upsert(snapshot: NavSnapshot, signal: AbortSignal): Promise<void>
  list(options: {
    readonly baseCurrency: CurrencyCode
    readonly signal: AbortSignal
  }): Promise<readonly NavSnapshot[]>
}

export type NavSnapshotTick = (signal: AbortSignal) => Promise<void>

/** What the benchmark needs from stored bars, declared here: the market-data store implements it. */
export interface NavBarReader {
  listBars(options: {
    readonly instrument: InstrumentRef
    readonly fromDay: TradingDay
    readonly toDay: TradingDay
    readonly signal: AbortSignal
  }): Promise<readonly { readonly candle: { readonly at: TradingDay; readonly close: number } }[]>
}

export interface NavPoint {
  readonly day: TradingDay
  readonly navBase: number
  readonly index: number
}

export interface BenchmarkLeg {
  readonly segment: PortfolioSegment
  readonly weight: number
  readonly instrument?: InstrumentRef
}

export interface NavBenchmark {
  readonly legs: readonly BenchmarkLeg[]
  readonly points: readonly { readonly day: TradingDay; readonly index: number }[]
  readonly periodReturn: number
}

export interface NavHistory {
  readonly window: NavWindow
  readonly baseCurrency: CurrencyCode
  readonly points: readonly NavPoint[]
  readonly periodReturn?: number
  readonly maximumDrawdown?: number
  readonly currentDrawdown?: number
  readonly benchmark?: NavBenchmark
  readonly benchmarkGap?: BenchmarkGap
  /** Describes every snapshot kept, not only the window's, so a long history read through a thin
   *  window says "try a longer window" rather than "history just began". */
  readonly firstDay?: TradingDay
  readonly recordedCount: number
}

export interface NavHistoryOptions {
  readonly window: NavWindow
  readonly now: number
  readonly signal: AbortSignal
}

export interface NavService {
  history(options: NavHistoryOptions): Promise<NavHistory>
}
