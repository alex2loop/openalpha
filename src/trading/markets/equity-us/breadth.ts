import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { UsBoard } from '@/trading/markets/equity-us/board'
import type { BreadthTrend } from '@/trading/markets/overview-rollups'
import {
  US_BENCHMARK_TICKER,
  US_DISTRIBUTION_DAY_POLICY,
  US_DISTRIBUTION_TICKERS,
  US_LONG_TREND_SESSIONS,
  US_TREND_SESSIONS,
  US_TREND_SLOPE_SESSIONS,
} from '@/trading/markets/equity-us/policy'
import { usAdjustedCandles } from '@/trading/markets/equity-us/screen'
import { indexTrendReading, isAboveMean, seriesThrough } from '@/trading/markets/timeseries'

/** The board as it stood at `session`: the share of its names above their own 50- and 200-session
 *  mean, the benchmark fund's distance to its 50-session mean, and the distribution days of the
 *  index funds. A name whose series does not end on `session` sits out, as a fund's does; a reading
 *  nothing could measure is absent, never zero. */
export function usBreadthAt(board: UsBoard, session: TradingDay): BreadthTrend {
  const series = board.names.flatMap((name) => {
    const candles = seriesThrough(usAdjustedCandles(name.bars), session)

    return candles === undefined ? [] : [candles.map((candle) => candle.close)]
  })
  const above50 = aboveMean(series, US_TREND_SESSIONS)
  const above200 = aboveMean(series, US_LONG_TREND_SESSIONS)
  const benchmark = fundSeries(board, US_BENCHMARK_TICKER, session)

  return {
    ...(above50 === undefined
      ? {}
      : { aboveMa50Ratio: above50.ratio, ma50Measured: above50.measured }),
    ...(above200 === undefined
      ? {}
      : { aboveMa200Ratio: above200.ratio, ma200Measured: above200.measured }),
    ...(benchmark === undefined
      ? {}
      : indexTrendReading(
          benchmark.map((candle) => candle.close),
          US_TREND_SESSIONS,
          US_TREND_SLOPE_SESSIONS
        )),
    ...distributionAt(board, session),
  }
}

interface AboveMean {
  readonly ratio: number
  readonly measured: number
}

/** The share above their own mean among the names with a full window behind them: a younger listing
 *  has no mean to be below, so it is left out of the count and the base. */
function aboveMean(series: readonly (readonly number[])[], window: number): AboveMean | undefined {
  const readings = series.flatMap((closes) => isAboveMean(closes, window) ?? [])

  return readings.length === 0
    ? undefined
    : { ratio: readings.filter(Boolean).length / readings.length, measured: readings.length }
}

function fundSeries(
  board: UsBoard,
  ticker: Ticker,
  session: TradingDay
): readonly Candle[] | undefined {
  const fund = board.funds.find((entry) => entry.record.instrument.ticker === ticker)

  return fund === undefined ? undefined : seriesThrough(usAdjustedCandles(fund.bars), session)
}

function distributionAt(board: UsBoard, session: TradingDay): Pick<BreadthTrend, 'distribution'> {
  const distribution = US_DISTRIBUTION_TICKERS.flatMap((ticker) => {
    const days = distributionDays(fundSeries(board, ticker, session))

    return days === undefined
      ? []
      : [{ ticker, days, sessions: US_DISTRIBUTION_DAY_POLICY.expirySessions }]
  })

  return distribution.length === 0 ? {} : { distribution }
}

/** Absent without the window's sessions and the one before them, and when any of them traded no
 *  volume: a count over a series with holes would read as a quiet market. */
function distributionDays(candles: readonly Candle[] | undefined): number | undefined {
  const { expirySessions } = US_DISTRIBUTION_DAY_POLICY

  if (candles === undefined || candles.length <= expirySessions) {
    return undefined
  }

  const window = candles.slice(-(expirySessions + 1))

  if (!window.every((candle) => candle.volume > 0)) {
    return undefined
  }

  return window.slice(1).filter((_, offset) => isDistributionDay(window, offset + 1)).length
}

function isDistributionDay(window: readonly Candle[], index: number): boolean {
  const { declineAtLeast, recoveryRise } = US_DISTRIBUTION_DAY_POLICY
  const previous = window[index - 1]
  const day = window[index]

  if (previous === undefined || day === undefined) {
    return false
  }

  const fell = day.close <= previous.close * (1 - declineAtLeast)
  const recovered = window
    .slice(index + 1)
    .some((later) => later.close >= day.close * (1 + recoveryRise))

  return fell && day.volume > previous.volume && !recovered
}
