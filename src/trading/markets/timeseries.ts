// Every market's trend, momentum, and volatility inputs reduce to these three primitives over a
// closes series. One owner keeps windowing (inclusive endpoints, population variance) from quietly
// disagreeing between markets; each market passes its own lookback constants from its `policy.ts`.

import type { Candle } from '@/trading/kernel/market/market-data'

interface AlignedCloses {
  readonly a: readonly number[]
  readonly b: readonly number[]
}

/** Pairs two candle series by trading day before extracting parallel close arrays. Zipping two
 *  series by array position is the bug this guards: one session missing from either series shifts
 *  every later pairing and produces a comparison that is quietly wrong rather than absent. */
export function alignedCloses(a: readonly Candle[], b: readonly Candle[]): AlignedCloses {
  const bByDay = new Map(b.map((candle) => [candle.at, candle.close]))
  const aCloses: number[] = []
  const bCloses: number[] = []

  for (const candle of a) {
    const bClose = bByDay.get(candle.at)

    if (bClose !== undefined && bClose > 0 && candle.close > 0) {
      aCloses.push(candle.close)
      bCloses.push(bClose)
    }
  }

  return { a: aCloses, b: bCloses }
}

/** Empty below `sessions` closes rather than a partial window: a caller reading the last element
 *  gets `undefined`, not an average over fewer sessions than its name promises. */
function movingAverage(closes: readonly number[], sessions: number): readonly number[] {
  if (sessions <= 0 || closes.length < sessions) {
    return []
  }

  const out: number[] = []
  let sum = 0

  for (let index = 0; index < closes.length; index += 1) {
    sum += closes[index] ?? 0

    if (index >= sessions) {
      sum -= closes[index - sessions] ?? 0
    }

    if (index >= sessions - 1) {
      out.push(sum / sessions)
    }
  }

  return out
}

/** Close-to-close return over `sessions` trading days, ending at the last close. Absent below
 *  `sessions + 1` closes or a non-positive starting close — a return has no sign against zero. */
export function nSessionReturn(closes: readonly number[], sessions: number): number | undefined {
  if (sessions <= 0) {
    return undefined
  }

  const start = closes[closes.length - 1 - sessions]
  const end = closes[closes.length - 1]

  return start === undefined || end === undefined || start <= 0 ? undefined : end / start - 1
}

/** The middle of a population, averaging the two middle readings on an even count so the answer
 *  never lands on one row's number. Non-finite entries are dropped; nothing left has no middle. */
export function median(values: readonly number[]): number | undefined {
  const sorted = values.filter(Number.isFinite).toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const lower = sorted[sorted.length % 2 === 0 ? middle - 1 : middle]
  const upper = sorted[middle]

  return lower === undefined || upper === undefined ? undefined : (lower + upper) / 2
}

/** The last completed session's close-to-close return. */
export function sessionChange(closes: readonly number[]): number | undefined {
  return nSessionReturn(closes, 1)
}

/** Population stdev of daily returns over `sessions` days — not annualized, because every consumer
 *  uses it as a rank or relative input, never a standalone percentage. */
export function realizedVolatility(
  closes: readonly number[],
  sessions: number
): number | undefined {
  const returns = dailyReturns(closes, sessions)

  if (returns === undefined) {
    return undefined
  }

  const meanValue = returns.reduce((sum: number, value) => sum + value, 0) / returns.length
  const variance =
    returns.reduce((sum: number, value) => sum + (value - meanValue) ** 2, 0) / returns.length

  return Math.sqrt(variance)
}

/** The latest session's volume against the average of the `sessions` before it. The baseline
 *  excludes the session being measured, so a single enormous day cannot inflate the average it is
 *  being compared against. Absent when the window is short or nothing traded across it. */
export function relativeVolume(volumes: readonly number[], sessions: number): number | undefined {
  if (sessions <= 0 || volumes.length <= sessions) {
    return undefined
  }

  const latest = volumes[volumes.length - 1]
  const baseline = volumes.slice(-(sessions + 1), -1)
  const mean = baseline.reduce((sum, value) => sum + value, 0) / baseline.length

  return latest === undefined || mean <= 0 ? undefined : latest / mean
}

function dailyReturns(closes: readonly number[], sessions: number): number[] | undefined {
  if (sessions <= 0 || closes.length < sessions + 1) {
    return undefined
  }

  const window = closes.slice(-(sessions + 1))
  const returns: number[] = []

  for (let index = 1; index < window.length; index += 1) {
    const previous = window[index - 1]
    const current = window[index]

    if (previous === undefined || current === undefined || previous <= 0) {
      return undefined
    }

    returns.push(current / previous - 1)
  }

  return returns
}

/** Close divided by its moving average, minus one. Absent below a full window — a trend measured
 *  over fewer sessions than the lookback names is a different statistic. */
export function trendDistance(closes: readonly number[], sessions: number): number | undefined {
  const averages = movingAverage(closes, sessions)
  const average = averages[averages.length - 1]
  const last = closes[closes.length - 1]

  return average === undefined || last === undefined || average <= 0
    ? undefined
    : last / average - 1
}

/** Last close over the trailing-window high, in (0, 1]. Undefined below the window: a young listing
 *  has no year to be near the top of. */
export function yearHighProximity(closes: readonly number[], sessions: number): number | undefined {
  if (closes.length < sessions) {
    return undefined
  }

  const last = closes[closes.length - 1]
  const high = trailingHigh(closes, sessions)

  return last === undefined || high === undefined ? undefined : last / high
}

/** The highest close in the window, which is what the proximity factor measures against and what a
 *  breakout condition is written in terms of. */
export function trailingHigh(closes: readonly number[], sessions: number): number | undefined {
  // `slice(-0)` is the whole array, so a zero window would answer with an all-time high.
  if (sessions <= 0 || closes.length < sessions) {
    return undefined
  }

  const high = Math.max(...closes.slice(-sessions))

  return high > 0 ? high : undefined
}

/** The lowest close in the window: where a breakout that failed would have proved itself wrong. */
export function trailingLow(closes: readonly number[], sessions: number): number | undefined {
  if (sessions <= 0 || closes.length < sessions) {
    return undefined
  }

  const low = Math.min(...closes.slice(-sessions))

  return low > 0 ? low : undefined
}

/** The last point of the moving average the trend statistic reads. */
export function trailingAverage(closes: readonly number[], sessions: number): number | undefined {
  const average = movingAverage(closes, sessions)

  return average[average.length - 1]
}

/** How far the moving average itself has moved over `slopeSessions`. Absent below a full window
 *  plus the slope lookback: a slope measured against a shorter history is a different statistic. */
export function averageSlope(
  closes: readonly number[],
  sessions: number,
  slopeSessions: number
): number | undefined {
  const average = movingAverage(closes, sessions)
  const now = average[average.length - 1]
  const then = average[average.length - 1 - slopeSessions]

  return now === undefined || then === undefined || then <= 0 ? undefined : now / then - 1
}

/** Moving-average distance plus moving-average slope, averaged — the shared trend statistic. Both
 *  halves are published separately, and this is their mean, so a factor's score and a rendered row
 *  can never disagree about either. */
export function trendWithSlope(
  closes: readonly number[],
  sessions: number,
  slopeSessions: number
): number | undefined {
  const distance = trendDistance(closes, sessions)
  const slope = averageSlope(closes, sessions, slopeSessions)

  return distance === undefined || slope === undefined ? undefined : (distance + slope) / 2
}

const PERCENTILE_MAX = 100

/** Share of `values` at or below `value`, as a 0-100 integer. Undefined over an empty history:
 *  a percentile against nothing would read as a real ranking. */
export function percentileRank(values: readonly number[], value: number): number | undefined {
  if (values.length === 0) {
    return undefined
  }

  const below = values.filter((candidate) => candidate <= value).length
  return Math.round((below / values.length) * PERCENTILE_MAX)
}
