import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { InstrumentStatistics } from '@/trading/kernel/market/market-capability'
import type { Candle } from '@/trading/kernel/market/market-data'
import { realizedVolatility } from '@/trading/markets/timeseries'

const SESSION_MARGIN = 5

/** Daily standard deviations the live price may sit from the last close before anything built on
 *  that close describes a session that has moved on. Two is the conventional line between an
 *  ordinary session and a regime change, and deliberately loose. */
const GAP_VOLATILITY_SIGMAS = 2

interface StatisticsWindow {
  readonly instrument: InstrumentRef
  readonly asOf: TradingDay
  readonly liquiditySessions: number
  readonly volatilitySessions: number
}

/** How many bars `statisticsFromCandles` needs. Volatility reads one close more than its sessions,
 *  and the margin absorbs a provider returning a session short — which otherwise drops volatility
 *  while turnover still computes, so the name is sized against a default and nothing says so. */
export function statisticsSessions(liquiditySessions: number, volatilitySessions: number): number {
  return Math.max(liquiditySessions, volatilitySessions + 1) + SESSION_MARGIN
}

/** Turnover and volatility from a candle window, for markets whose bars are their only stored
 *  evidence. Null when no candle carries a usable volume — a spot series with no volume has no
 *  measurable turnover, and inventing one would size against it. */
export function statisticsFromCandles(
  candles: readonly Candle[],
  options: StatisticsWindow
): InstrumentStatistics | null {
  const window = candles.slice(-options.liquiditySessions)
  const turnovers = window
    .map((candle) => candle.close * candle.volume)
    .filter((value) => Number.isFinite(value) && value > 0)

  if (turnovers.length === 0) {
    return null
  }

  const volatilityDaily = realizedVolatility(
    candles.map((candle) => candle.close),
    options.volatilitySessions
  )

  return {
    instrument: options.instrument,
    asOf: options.asOf,
    sessions: window.length,
    // Over every session in the window, not only those that traded: a name that changed hands on
    // five of twenty days is thin, and a five-day average would report it as liquid.
    averageDailyTurnover: turnovers.reduce((sum, value) => sum + value, 0) / window.length,
    ...(volatilityDaily === undefined ? {} : { volatilityDaily }),
  }
}

/** One line for the screen row and the suggestion priced off the same live quote. */
export function isGappedPastClose(
  price: number,
  previousClose: number,
  volatilityDaily: number
): boolean {
  if (!(previousClose > 0 && volatilityDaily > 0)) {
    return false
  }

  return Math.abs(price / previousClose - 1) >= GAP_VOLATILITY_SIGMAS * volatilityDaily
}
