import type { FactorMetric } from '@/trading/kernel/factor-metric'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type {
  BarRecord,
  Candle,
  FlowSnapshot,
  FundamentalSnapshot,
  InstrumentRecord,
  SourceStamp,
} from '@/trading/kernel/market/market-data'
import type { SupervisionLevel } from '@/trading/kernel/market/supervision'
import type { TapeReading } from '@/trading/kernel/market/tape'
import type { ScreenGateCode } from '@/trading/kernel/screen-codes'
import type { MarketDeps } from '@/trading/markets/deps'
import type { StaleFactors } from '@/trading/markets/equity-vn/evidence/factor-staleness'
import type { ScreenInput } from '@/trading/markets/equity-vn/screen'
import type { WindowSum } from '@/trading/markets/equity-vn/tape/flows'
import type { BarsManifest } from '@/trading/markets/name-readings'
import type { TradingCalendar } from '@/trading/markets/types'
import { definedOnly } from '@/core/utils/collections'
import { staleFactorsOf } from '@/trading/markets/equity-vn/evidence/factor-staleness'
import { benchmarkBars, etfTrackingError } from '@/trading/markets/equity-vn/factors/etf'
import {
  DAILY_BAND_BY_EXCHANGE,
  FLOW_DEVIATION_SESSIONS,
  LIQUIDITY_SESSIONS,
  RELATIVE_VOLUME_SESSIONS,
  SPECULATIVE_TURNOVER_SESSIONS,
  VN_PROPRIETARY_LOOKBACK_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import {
  adjustedCandles,
  adjustedCloses,
  failedGates,
  isAdjustedBar,
  toScreenInput,
} from '@/trading/markets/equity-vn/screen'
import {
  foreignFlowRatio,
  foreignNetFlow,
  netFlowValue,
  newestFlowDay,
  proprietaryFlowRatio,
  proprietaryFlowValue,
  proprietaryNetFlow,
} from '@/trading/markets/equity-vn/tape/flows'
import { tapeReadings } from '@/trading/markets/equity-vn/tape/signals'
import { ceilingRunOf } from '@/trading/markets/equity-vn/tradeability'
import { boardBarReadings } from '@/trading/markets/name-readings'
import { relativeVolume } from '@/trading/markets/timeseries'
import { averageTurnover, barTurnover, medianTurnover } from '@/trading/markets/turnover'

export interface NameEvidence {
  readonly record: InstrumentRecord
  readonly bars: readonly BarRecord[]
  readonly closes: readonly number[]
  readonly flows: readonly FlowSnapshot[]
  readonly fundamental: FundamentalSnapshot | null
  /** Absent means the exchange has declared nothing about this name, or nothing could be read. */
  readonly supervision?: SupervisionLevel
  /** What an ordinary session trades, in đồng. Absent where the window held no usable session. */
  readonly turnover?: number
  /** A year of average daily traded value, in đồng. Absent where the window held no usable session. */
  readonly annualTurnover?: number
  /** Clears every screen gate. Decides both who reaches the board and the population the ranked
   *  factors normalize over, so it is resolved once here rather than by each caller. */
  readonly screened: boolean
  /** Every gate the name fails, in table order; `screened` is exactly "none". */
  readonly failedGates: readonly ScreenGateCode[]
  readonly lockPrice?: number
  readonly foreignRoomExhausted?: true
  readonly history: BarHistory
  readonly lastBar?: LastBar
  readonly flowReads: NameFlowReads
  readonly tapeReadings: readonly TapeReading[]
  /** The factors whose source lags the tape, for `withStaleCaveats`. */
  readonly staleFactors: StaleFactors
  /** A fund's dispersion against its index. Absent for a share and for a fund nothing measures. */
  readonly trackingError?: number
  /** The newest session's volume against the sessions before it. */
  readonly relativeVolume?: number
  /** The day `closes` ends on, which the last bar of any kind need not be. */
  readonly lastAdjustedAt?: TradingDay
  /** How many of the newest sessions in a row closed at the ceiling. Absent for a fund. */
  readonly ceilingRun?: number
  /** The series readings a board row carries: set only for a name that clears every gate. */
  readonly boardMetrics?: readonly FactorMetric[]
}

/** What one name's pass reads from the store, before any of it is reduced. */
export interface NameReads {
  readonly record: InstrumentRecord
  readonly bars: readonly BarRecord[]
  readonly flows: readonly FlowSnapshot[]
  readonly fundamental: FundamentalSnapshot | null
}

/** The store window every name is read over. */
export interface NameWindow {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
  readonly signal: AbortSignal
}

/** What the pass knows about the day, shared by every name it reduces. */
export interface NameEvidenceContext {
  readonly asOf: TradingDay
  readonly freshFrom: TradingDay
  readonly supervision: ReadonlyMap<Ticker, SupervisionLevel>
  readonly index: readonly Candle[]
  readonly benchmarks: ReadonlyMap<Ticker, readonly BarRecord[]>
  readonly calendar: TradingCalendar
  readonly manifest: BarsManifest
}

/** Every bar of the window, column-wise: what the readers that count by day walk. */
interface BarHistory {
  /** One shared string per day: the store interns them across names. */
  readonly days: readonly TradingDay[]
  /** The raw close of each bar, adjusted or not. */
  readonly closes: readonly number[]
  /** Whether each bar can carry a session statistic: see `isTradedBar`. */
  readonly traded: readonly boolean[]
  /** Whether each bar is one of the name's `closes`, so a cut by day cuts `closes` to match. */
  readonly inCloses: readonly boolean[]
}

/** The newest bar of any kind: where its figures came from and what the session traded. */
interface LastBar extends SourceStamp {
  readonly at: TradingDay
  readonly turnover?: number
}

/** What the desks' flows say, read once from the full series before it is dropped. */
interface NameFlowReads {
  readonly foreignRatio?: number
  readonly proprietaryRatio?: number
  /** The net over the aligned sessions the ratio averaged. */
  readonly foreignNet?: WindowSum
  readonly proprietaryNet?: WindowSum
  readonly foreignAt?: TradingDay
  readonly proprietaryAt?: TradingDay
  /** The net over the newest flow sessions, aligned to a bar or not. */
  readonly foreignNet20: number
  /** `null` where no session carries the figure, so an unreported desk never reads as a quiet one. */
  readonly proprietaryFlow20: number | null
  /** Every flow after the name's newest bar day, plus the last few at or before it: the market's
   *  newest flow days read per name, which flows running ahead of the bars would displace. Exact
   *  at `latestNameSession` and the `VN_PROPRIETARY_LOOKBACK_SESSIONS` flow days before it, which
   *  is all `proprietaryLeaders` reads. */
  readonly flowTail: readonly FlowSnapshot[]
}

/** The market's per-day sums, folded name by name while each name's bars and flows are still in
 *  hand: no later reader can rebuild them once those are dropped. */
export interface MarketDayTotals {
  readonly turnover: ReadonlyMap<TradingDay, number>
  /** Each entry carries the instrument of the first name that reported its day, not the market's:
   *  a reader stamps the market's when it turns the map into snapshots. */
  readonly flows: ReadonlyMap<TradingDay, FlowSnapshot>
  /** The flow with the newest `fetchedAt`, which the market-wide flow read stamps as its source. */
  readonly newestFlow?: FlowSnapshot
}

export async function readNameReads(
  deps: MarketDeps,
  record: InstrumentRecord,
  window: NameWindow
): Promise<NameReads> {
  const { fromDay, toDay, signal } = window
  const series = { instrument: record.instrument, fromDay, toDay, signal }
  const [bars, flows, fundamental] = await Promise.all([
    deps.marketDataStore.listBars(series),
    deps.marketDataStore.listFlows(series),
    deps.marketDataStore.findLatestFundamental({
      instrument: record.instrument,
      asOf: toDay,
      signal,
    }),
  ])

  return { record, bars, flows, fundamental }
}

/** Pure: the same reads and context always give the same evidence. Every figure below comes from
 *  the shared owner of its arithmetic, called on the raw arrays. */
export function toNameEvidence(reads: NameReads, context: NameEvidenceContext): NameEvidence {
  const { record, bars, flows, fundamental } = reads
  const supervision = context.supervision.get(record.instrument.ticker)
  const source = {
    record,
    bars,
    history: toBarHistory(bars),
    fundamental,
    closes: adjustedCloses(bars),
    ...(supervision === undefined ? {} : { supervision }),
  }
  const screen = toScreenInput(source, context.asOf)
  const failed = failedGates(screen)
  const candles = adjustedCandles(bars)

  return {
    ...source,
    flows,
    screened: failed.length === 0,
    failedGates: failed,
    flowReads: toFlowReads(flows, bars),
    tapeReadings: tapeReadings({ closes: source.closes, flows, bars }),
    staleFactors: toStaleFactors(reads, context),
    ...definedOnly({
      turnover: medianTurnover(bars, LIQUIDITY_SESSIONS),
      annualTurnover: averageTurnover(bars, SPECULATIVE_TURNOVER_SESSIONS),
      lastBar: toLastBar(bars),
      lockPrice: screen.lockPrice,
      foreignRoomExhausted: screen.foreignRoomExhausted,
      trackingError:
        record.kind === 'etf'
          ? etfTrackingError(record.instrument.ticker, candles, context.benchmarks)
          : undefined,
      relativeVolume: relativeVolume(
        bars.map((bar) => bar.candle.volume),
        RELATIVE_VOLUME_SESSIONS
      ),
      lastAdjustedAt: candles.at(-1)?.at,
      ceilingRun: toCeilingRun(screen, candles, context),
      boardMetrics: failed.length === 0 ? toBoardMetrics(bars, context) : undefined,
    }),
  }
}

function toBarHistory(bars: readonly BarRecord[]): BarHistory {
  return {
    days: bars.map((bar) => bar.candle.at),
    closes: bars.map((bar) => bar.candle.close),
    traded: bars.map((bar) => isTradedBar(bar)),
    inCloses: bars.map((bar) => isAdjustedBar(bar)),
  }
}

/** Whether a bar can carry a session statistic. Zero volume carries the previous close forward, so
 *  counting it reads as a name that held its price. An unadjusted bar prices a split as a crash,
 *  and `closes` has already dropped it, so its day would date a move the series does not hold. */
function isTradedBar(bar: BarRecord | undefined): bar is BarRecord {
  return bar !== undefined && bar.candle.adjustment === 'adjusted' && bar.candle.volume > 0
}

function toLastBar(bars: readonly BarRecord[]): LastBar | undefined {
  const last = bars.at(-1)

  if (last === undefined) {
    return undefined
  }

  const turnover = barTurnover(last)

  return {
    at: last.candle.at,
    sourceId: last.sourceId,
    fetchedAt: last.fetchedAt,
    ...(turnover === undefined ? {} : { turnover }),
  }
}

function toFlowReads(flows: readonly FlowSnapshot[], bars: readonly BarRecord[]): NameFlowReads {
  return {
    ...definedOnly({
      foreignRatio: foreignFlowRatio(flows, bars),
      proprietaryRatio: proprietaryFlowRatio(flows, bars),
      foreignNet: foreignNetFlow(flows, bars),
      proprietaryNet: proprietaryNetFlow(flows, bars),
      foreignAt: newestFlowDay(flows, (flow) => flow.foreignNetValue),
      proprietaryAt: newestFlowDay(flows, (flow) => flow.proprietaryNetValue),
    }),
    foreignNet20: netFlowValue(flows, FLOW_DEVIATION_SESSIONS),
    proprietaryFlow20: proprietaryFlowValue(flows, FLOW_DEVIATION_SESSIONS),
    flowTail: toFlowTail(flows, bars.at(-1)?.candle.at),
  }
}

function toFlowTail(
  flows: readonly FlowSnapshot[],
  newestBarDay: TradingDay | undefined
): readonly FlowSnapshot[] {
  if (newestBarDay === undefined) {
    return flows
  }

  return [
    ...flows.filter((flow) => flow.at <= newestBarDay).slice(-VN_PROPRIETARY_LOOKBACK_SESSIONS),
    ...flows.filter((flow) => flow.at > newestBarDay),
  ]
}

function toStaleFactors(reads: NameReads, context: NameEvidenceContext): StaleFactors {
  const { record, bars, flows, fundamental } = reads
  // A fund's factors read its index, so the index's own newest session is judged beside the fund's.
  const benchmarkAt =
    record.kind === 'etf'
      ? benchmarkBars(record.instrument.ticker, context.benchmarks)?.at(-1)?.candle.at
      : undefined

  return staleFactorsOf(
    { bars, flows, fundamental, ...(benchmarkAt === undefined ? {} : { benchmarkAt }) },
    context.freshFrom
  )
}

/** The run of ceiling closes is a fact about the tape; whether it is still worth trimming depends
 *  on the clock and the policy, which the reader applies. A fund has none. */
function toCeilingRun(
  screen: ScreenInput,
  candles: readonly Candle[],
  context: NameEvidenceContext
): number | undefined {
  if (screen.kind === 'etf' || candles.length === 0) {
    return undefined
  }

  return ceilingRunOf(candles, {
    bandPct: DAILY_BAND_BY_EXCHANGE[screen.exchange].maximumUpPct,
    calendar: context.calendar,
    ...(screen.listedOn === undefined ? {} : { listedOn: screen.listedOn }),
  })
}

/** Only for a name the screen shows: nobody reads a board row of one it rejected. */
function toBoardMetrics(
  bars: readonly BarRecord[],
  context: NameEvidenceContext
): readonly FactorMetric[] {
  return boardBarReadings({
    manifest: context.manifest,
    candles: bars.map((bar) => bar.candle),
    benchmark: context.index,
  })
}
