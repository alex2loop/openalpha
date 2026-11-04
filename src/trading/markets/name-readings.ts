import type { Logger } from '@/core/logging/logger'
import type { FactorMetric, FactorMetricId } from '@/trading/kernel/factor-metric'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { Candle, FundingSnapshot } from '@/trading/kernel/market/market-data'
import type { MarketEvent } from '@/trading/kernel/market/market-event'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { MarketManifest } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { definedOnly } from '@/core/utils/collections'
import { EVENTS_AHEAD_DAYS } from '@/trading/kernel/market/market-event'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import { averageTrueRange, hasIntradayRange } from '@/trading/markets/levels'
import {
  alignedCloses,
  median,
  nSessionReturn,
  relativeVolume,
  trailingHigh,
  trailingLow,
} from '@/trading/markets/timeseries'
import { candleTurnover } from '@/trading/markets/turnover'
import { PERCENT_PER_UNIT } from '@/trading/sources/rows/normalization'

/** The span the distance from the high and the low is read over, in sessions: the year the VN
 *  proximity factor already measures against. The span is stated beside every reading, so a market
 *  whose series is shorter than this prints nothing rather than a different year. */
const HIGH_LOW_SESSIONS = 240
/** About three months of sessions. */
const MOVE_SESSIONS = 63
/** The average the day's volume and the median traded value are read over: a trading month. */
const VOLUME_SESSIONS = 20
/** The window the daily range averages, the same fourteen sessions every market's levels read. */
const RANGE_SESSIONS = 14
/** The drivers a market backdrop lists, heaviest first: enough to say where the tape and the price
 *  of money stand, few enough to be one line. */
const BACKDROP_DRIVERS = 2
/** What a board row prints of the series' readings: where the name sits in its year, how far it
 *  swings and its move against the index. The liquidity readings are the board's own columns. */
const BOARD_BAR_READING_IDS: ReadonlySet<FactorMetricId> = new Set([
  'distance-from-high',
  'average-range',
  'relative-return',
])

/** What the series' readings ask of a market: how to treat its bars. */
export type BarsManifest = Pick<MarketManifest, 'assetClass' | 'referenceBarsOnly'>

interface BarReadingsInput {
  readonly manifest: BarsManifest
  readonly candles: readonly Candle[]
  /** The market's own index over the same sessions. Absent where the market names none. */
  readonly benchmark?: readonly Candle[]
}

/** What the name's own daily series says about where it stands and how it trades: its distance
 *  from the year's extremes, how far it moves in a session, its move against the index, and its
 *  liquidity. A reading the series is too short or too coarse for is absent, never zero. A market
 *  whose bars are another instrument's reference series states nothing about the name. */
export function barReadings(input: BarReadingsInput): readonly FactorMetric[] {
  const { manifest } = input

  if (manifest.referenceBarsOnly === true) {
    return []
  }

  const candles = usableCandles(input.candles, manifest)
  const closes = candles.map((candle) => candle.close)
  const last = closes[closes.length - 1]

  if (last === undefined) {
    return []
  }

  return [
    ...distance('distance-from-high', last, trailingHigh(closes, HIGH_LOW_SESSIONS)),
    ...distance('distance-from-low', last, trailingLow(closes, HIGH_LOW_SESSIONS)),
    ...averageRange(candles, last),
    ...moveAgainstIndex(candles, usableCandles(input.benchmark ?? [], manifest)),
    ...liquidity(candles),
  ]
}

/** The series readings a board row carries beside its factors. */
export function boardBarReadings(input: BarReadingsInput): readonly FactorMetric[] {
  return barReadings(input).filter((reading) => BOARD_BAR_READING_IDS.has(reading.id))
}

/** A share's unadjusted bar prices a split as a crash, so an equity reads only its adjusted rows;
 *  a coin has no split to mis-price and its venues publish raw rows by nature. */
function usableCandles(candles: readonly Candle[], manifest: BarsManifest): readonly Candle[] {
  return candles.filter(
    (candle) =>
      candle.close > 0 && (manifest.assetClass !== 'equity' || candle.adjustment === 'adjusted')
  )
}

function distance(
  id: 'distance-from-high' | 'distance-from-low',
  last: number,
  extreme: number | undefined
): readonly FactorMetric[] {
  return extreme === undefined
    ? []
    : [{ id, value: (last / extreme - 1) * PERCENT_PER_UNIT, sessions: HIGH_LOW_SESSIONS }]
}

/** The range as a share of the price, so two names of different price are comparable. A close-only
 *  feed collapses the range to the close-to-close move, about half of a real one, so it abstains. */
function averageRange(candles: readonly Candle[], last: number): readonly FactorMetric[] {
  if (candles.length <= RANGE_SESSIONS || !hasIntradayRange(candles, RANGE_SESSIONS)) {
    return []
  }

  return [
    {
      id: 'average-range',
      value: (averageTrueRange(candles, RANGE_SESSIONS) / last) * PERCENT_PER_UNIT,
      sessions: RANGE_SESSIONS,
    },
  ]
}

/** In points of percent, over the sessions both series printed. An index that stops short of the
 *  name's last session measures a different span, so it abstains instead. */
function moveAgainstIndex(
  candles: readonly Candle[],
  benchmark: readonly Candle[]
): readonly FactorMetric[] {
  if (candles.at(-1)?.at !== benchmark.at(-1)?.at) {
    return []
  }

  const paired = alignedCloses(candles, benchmark)
  const own = nSessionReturn(paired.a, MOVE_SESSIONS)
  const index = nSessionReturn(paired.b, MOVE_SESSIONS)

  return own === undefined || index === undefined
    ? []
    : [{ id: 'relative-return', value: (own - index) * PERCENT_PER_UNIT, sessions: MOVE_SESSIONS }]
}

/** Today's volume only where the name traded: a session with none carries the previous close and
 *  reads as nobody trading, which is not a volume to compare. */
function liquidity(candles: readonly Candle[]): readonly FactorMetric[] {
  const turnover = median(
    candles
      .slice(-VOLUME_SESSIONS)
      .map(candleTurnover)
      .filter((value): value is number => value !== undefined)
  )
  const relative =
    (candles.at(-1)?.volume ?? 0) > 0
      ? relativeVolume(
          candles.map((candle) => candle.volume),
          VOLUME_SESSIONS
        )
      : undefined

  return [
    ...(turnover === undefined || turnover <= 0
      ? []
      : [{ id: 'median-turnover' as const, value: turnover, sessions: VOLUME_SESSIONS }]),
    ...(relative === undefined
      ? []
      : [{ id: 'relative-volume' as const, value: relative, sessions: VOLUME_SESSIONS }]),
  ]
}

/** Where the perpetual's positioning stands: what longs pay, how the open contracts changed and how
 *  accounts split. */
export function fundingReadings(snapshot: FundingSnapshot): readonly FactorMetric[] {
  return [
    { id: 'funding-daily', value: snapshot.fundingDailyPct },
    ...openInterestReading(snapshot),
    ...longShortReading(snapshot),
  ]
}

/** The change is the contract count's, never the notional's. */
export function openInterestReading(snapshot: FundingSnapshot): readonly FactorMetric[] {
  const { openInterestChange } = snapshot

  return openInterestChange === undefined
    ? []
    : [
        {
          id: 'open-interest-change',
          value: openInterestChange.value * PERCENT_PER_UNIT,
          sessions: openInterestChange.sessions,
        },
      ]
}

export function longShortReading(snapshot: FundingSnapshot): readonly FactorMetric[] {
  const { longShortRatio } = snapshot

  return longShortRatio === undefined ? [] : [{ id: 'long-short-ratio', value: longShortRatio }]
}

interface BackdropReading {
  readonly id: MacroSeriesId
  readonly unit: 'percent' | 'level'
  readonly value: number
}

/** The series carrying the most weight in the market's own composite, as plain readings: the
 *  composite, its regime and its score stay out, because they are the verdict and these are the
 *  numbers it was made from. */
export function backdropReadings(view: MacroRiskView): readonly BackdropReading[] {
  return view.drivers
    .toSorted((left, right) => right.weight - left.weight)
    .slice(0, BACKDROP_DRIVERS)
    .map(({ id, unit, value }) => ({ id, unit, value }))
}

/** The market's own index, where it names one the name is not itself. A name is not measured
 *  against itself, and a market that names no index has no move to compare. */
export function benchmarkOf(
  manifest: MarketManifest,
  instrument: InstrumentRef
): InstrumentRef | undefined {
  const { benchmark } = manifest

  return benchmark === undefined || benchmark.ticker === instrument.ticker ? undefined : benchmark
}

/** A read the analysis can do without. A failure leaves its group out and is logged; a cancel
 *  still stops the run, since a caller that gave up is not told the read merely failed. */
export async function optionally<T>(
  logger: Logger,
  name: string,
  run: Promise<T> | undefined
): Promise<T | undefined> {
  try {
    return await run
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    logger.warn('trading.analysis_context_failed', { read: name, err: formatErrForLog(err) })

    return undefined
  }
}

/** The nearest events inside the days a surface lists ahead, soonest first as the read hands them,
 *  worded as the provider wrote them. */
export function nearestEvents(
  events: readonly MarketEvent[],
  asOf: TradingDay,
  limit: number
): readonly Pick<MarketEvent, 'at' | 'kind' | 'title' | 'detail' | 'composedText'>[] {
  const last = shiftCalendarDay(asOf, EVENTS_AHEAD_DAYS)

  return events
    .filter((event) => event.at <= last)
    .slice(0, limit)
    .map((event) => ({
      at: event.at,
      kind: event.kind,
      title: event.title,
      ...definedOnly({ detail: event.detail, composedText: event.composedText }),
    }))
}
