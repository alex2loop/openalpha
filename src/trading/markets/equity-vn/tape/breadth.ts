import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { IndexRatioId } from '@/trading/kernel/market/index-reading'
import type { Candle } from '@/trading/kernel/market/market-data'
import type {
  MarketBreadth,
  MarketBreadthComponents,
} from '@/trading/kernel/market/market-overview'
import type { NameEvidence } from '@/trading/markets/equity-vn/factors/factors'
import { sessionBar } from '@/trading/markets/equity-vn/factors/factors'
import {
  LONG_TREND_SESSIONS,
  TREND_SESSIONS,
  TREND_SLOPE_SESSIONS,
  VN_INDEX_TICKER,
  VN_MA_SESSIONS,
  VN_TURNOVER_REFERENCE_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import { resolveBandReference, resolveTradeability } from '@/trading/markets/equity-vn/tradeability'
import { averageSlope, sessionChange, trendDistance } from '@/trading/markets/timeseries'

/** The index ratios a basket's names answer for, each with the mean its names are measured against. */
const MEAN_RATIO_WINDOWS = Object.freeze([
  ['aboveMa50Ratio', VN_MA_SESSIONS],
  ['aboveMa200Ratio', LONG_TREND_SESSIONS],
] as const satisfies readonly (readonly [IndexRatioId, number])[])

const MA_WINDOWS = Object.freeze({
  short: VN_TURNOVER_REFERENCE_SESSIONS,
  long: VN_MA_SESSIONS,
} as const)

/** A 52-week extreme is the year of sessions a reader means by it, not the calendar year. */
const YEAR_SESSIONS = 250

interface Tally {
  measured: number
  advancers: number
  decliners: number
  ceilings: number
  floors: number
  above20: number
  below20: number
  above50: number
  below50: number
  newHighs: number
  newLows: number
  /** Names whose series reaches back a full year. Zero means the window could not be measured,
   *  which is a different fact from a session where nobody hit an extreme. */
  yearMeasured: number
}

/** Listed shares only. An ETF is a basket of the same constituents, so counting it measures the
 *  index a second time and biases the tally toward whichever way the market went; a future is not a
 *  listing at all. Both are in the universe this reads, and both are excluded here rather than by
 *  the accident that their bars are stored unadjusted.
 *
 *  Absent when no name has a measurable session, so a population that produced no reading is never
 *  reported as an unchanged market. */
export function toBreadth(
  names: readonly NameEvidence[],
  asOf: TradingDay,
  indexBars?: readonly Candle[]
): MarketBreadth | undefined {
  const tally: Tally = {
    measured: 0,
    advancers: 0,
    decliners: 0,
    ceilings: 0,
    floors: 0,
    above20: 0,
    below20: 0,
    above50: 0,
    below50: 0,
    newHighs: 0,
    newLows: 0,
    yearMeasured: 0,
  }

  for (const name of names) {
    if (name.record.kind === 'equity') {
      count(tally, name, asOf)
    }
  }

  if (tally.measured === 0) {
    return undefined
  }

  const settled = tally.advancers + tally.decliners
  const ma50Base = tally.above50 + tally.below50

  return {
    advancers: tally.advancers,
    decliners: tally.decliners,
    netAdvancers: tally.advancers - tally.decliners,
    measured: tally.measured,
    ceilings: tally.ceilings,
    floors: tally.floors,
    ...(settled === 0 ? {} : { advanceRatio: tally.advancers / settled }),
    ...(ma50Base === 0 ? {} : { aboveMa50Ratio: tally.above50 / ma50Base, ma50Measured: ma50Base }),
    ...(tally.yearMeasured === 0 ? {} : { newHighs: tally.newHighs, newLows: tally.newLows }),
    ...indexTrend(indexBars, asOf),
    components: toComponents(tally),
  }
}

/** `toBreadth` as the market stood at `day`: every name cut to the bars dated on or before it. The
 *  cut keeps `bars` and `closes` the same length, which they are index-aligned to be. Absent when no
 *  name settled that day. */
export function breadthAt(
  names: readonly NameEvidence[],
  day: TradingDay,
  indexBars?: readonly Candle[]
): MarketBreadth | undefined {
  return toBreadth(
    names.map((name) => truncatedAt(name, day)),
    day,
    indexBars
  )
}

/** The share of `names` above their own mean on `day`, as the provider prints it for an index that
 *  has its own ratios: of the names that traded that day with a full window behind them. A mean no
 *  name could measure is left out, never published as zero. */
export function aboveMeanRatios(
  names: readonly NameEvidence[],
  day: TradingDay
): Partial<Record<IndexRatioId, number>> {
  const settled = names
    .map((name) => truncatedAt(name, day))
    .filter((name) => sessionBar(name, day) !== undefined)

  return Object.fromEntries(
    MEAN_RATIO_WINDOWS.flatMap(([id, window]) => {
      const readings = settled.flatMap((name) => isAboveMean(name.closes, window) ?? [])

      return readings.length === 0 ? [] : [[id, readings.filter(Boolean).length / readings.length]]
    })
  )
}

function truncatedAt(name: NameEvidence, day: TradingDay): NameEvidence {
  const kept = name.bars.filter((bar) => bar.candle.at <= day).length

  return { ...name, bars: name.bars.slice(0, kept), closes: name.closes.slice(0, kept) }
}

/** The index series as it stood at `asOf`, or nothing when it does not reach that session. Every
 *  count beside these readings is admitted name by name at `asOf`, so a series that stops short —
 *  the index endpoint withholds the settled bar for hours after the shares have theirs — would put
 *  one session's trend under another's stamp, and one running ahead would do the reverse. */
function seriesThrough(
  bars: readonly Candle[] | undefined,
  asOf: TradingDay
): readonly Candle[] | undefined {
  const window = (bars ?? []).filter((bar) => bar.at <= asOf)

  return window[window.length - 1]?.at === asOf ? window : undefined
}

/** Empty while the index series reaches the counted session. Otherwise the two readings above are
 *  withheld, and this names the session the series actually stops at — an absent reading with no
 *  caveat reads as a market that published nothing. */
export function staleIndexCaveats(
  bars: readonly Candle[] | undefined,
  asOf: TradingDay
): readonly Caveat[] {
  const newest = bars === undefined ? undefined : bars[bars.length - 1]

  if (newest === undefined || seriesThrough(bars, asOf) !== undefined) {
    return []
  }

  return [
    {
      code: 'market-data.series-stale',
      detail: { ticker: VN_INDEX_TICKER, asOf: newest.at },
    },
  ]
}

/** Where the index itself stands against its own mean, beside the share of names that do. Empty for
 *  a fold over one board: a board has no index of its own. */
function indexTrend(
  bars: readonly Candle[] | undefined,
  asOf: TradingDay
): Pick<MarketBreadth, 'indexToMa50Pct' | 'ma50SlopePct'> {
  const closes = seriesThrough(bars, asOf)?.map((bar) => bar.close)

  if (closes === undefined) {
    return {}
  }

  const distance = trendDistance(closes, TREND_SESSIONS)
  const slope = averageSlope(closes, TREND_SESSIONS, TREND_SLOPE_SESSIONS)

  return {
    ...(distance === undefined ? {} : { indexToMa50Pct: distance }),
    ...(slope === undefined ? {} : { ma50SlopePct: slope }),
  }
}

/** Where the broad tape sits in its own recent distribution, plus the share of names above each mean.
 *  Each percentile is today's breadth rank within the trailing window the overview measures — a
 *  market that is 80% above its 50-day mean is unambiguously stretched. A ratio with nothing measured
 *  behind it is left out, never published as zero. */
function toComponents(tally: Tally): MarketBreadthComponents {
  const settled = tally.advancers + tally.decliners
  const ma20Base = tally.above20 + tally.below20
  const ma50Base = tally.above50 + tally.below50

  return {
    above20: tally.above20,
    below20: tally.below20,
    above50: tally.above50,
    below50: tally.below50,
    percentiles: {
      ...(settled === 0 ? {} : { 'advance-ratio': { value: tally.advancers / settled } }),
      ...(ma20Base === 0 ? {} : { 'above-ma20': { value: tally.above20 / ma20Base } }),
      ...(ma50Base === 0 ? {} : { 'above-ma50': { value: tally.above50 / ma50Base } }),
    },
  }
}

/** The band edges come from `resolveTradeability`, which already owns the per-exchange percentages
 *  and the tick rounding an exchange quotes them on — recomputing them from a percentage here would
 *  miss every name by a tick. */
function count(tally: Tally, name: NameEvidence, asOf: TradingDay): void {
  if (sessionBar(name, asOf) === undefined) {
    return
  }

  const change = sessionChange(name.closes)
  const close = name.closes[name.closes.length - 1]
  const reference = resolveBandReference(
    name.bars.map((bar) => bar.candle),
    asOf
  )

  if (change === undefined || close === undefined || reference === undefined) {
    return
  }

  tally.measured += 1

  if (change > 0) {
    tally.advancers += 1
  }

  if (change < 0) {
    tally.decliners += 1
  }

  const { dailyBand } = resolveTradeability({ record: name.record, reference, asOf })

  if (close >= dailyBand.ceiling) {
    tally.ceilings += 1
  }

  if (close <= dailyBand.floor) {
    tally.floors += 1
  }

  const above20 = isAboveMean(name.closes, MA_WINDOWS.short)

  if (above20 === true) {
    tally.above20 += 1
  } else if (above20 === false) {
    tally.below20 += 1
  }

  const above50 = isAboveMean(name.closes, MA_WINDOWS.long)

  if (above50 === true) {
    tally.above50 += 1
  } else if (above50 === false) {
    tally.below50 += 1
  }

  const extreme = yearExtreme(name.closes, close)

  if (extreme === undefined) {
    return
  }

  tally.yearMeasured += 1

  if (extreme === 'high') {
    tally.newHighs += 1
  }

  if (extreme === 'low') {
    tally.newLows += 1
  }
}

/** Whether today's close is the highest or lowest of its own trailing year. `undefined` is a series
 *  too short to ask, so a newly listed name never reports a 52-week high on day two and a universe
 *  with no year of history reports no count at all rather than a zero it never measured. */
function yearExtreme(
  closes: readonly number[],
  close: number
): 'high' | 'low' | 'none' | undefined {
  if (closes.length < YEAR_SESSIONS) {
    return undefined
  }

  const window = closes.slice(closes.length - YEAR_SESSIONS)

  if (close >= Math.max(...window)) {
    return 'high'
  }

  return close <= Math.min(...window) ? 'low' : 'none'
}

/** True when the latest close exceeds the trailing-window mean — the one definition of "above its
 *  own moving average" that needs no external series. Absent below a full window, never `false`:
 *  a young listing has no measurable mean, and reading it as "below" would count it in the
 *  above/below denominator without ever having been measured. */
function isAboveMean(closes: readonly number[], window: number): boolean | undefined {
  if (closes.length < window) {
    return undefined
  }

  const slice = closes.slice(closes.length - window)
  const mean = slice.reduce((sum, value) => sum + value, 0) / slice.length
  const last = closes[closes.length - 1]

  return last === undefined ? undefined : last > mean
}
