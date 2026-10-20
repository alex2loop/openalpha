import type { BarRecord } from '@/trading/kernel/market/market-data'
import { median } from '@/trading/markets/timeseries'

/** Value matched in one session, from the provider's own figure where it has one and price times
 *  volume where it does not. Undefined rather than zero for a bar that states neither: a session
 *  nobody measured is not a session nobody traded. */
export function barTurnover(bar: BarRecord): number | undefined {
  const value = bar.turnover ?? bar.candle.close * bar.candle.volume

  return Number.isFinite(value) && value >= 0 ? value : undefined
}

/** What an ordinary session in the window trades, and the only figure the board quotes: a handful
 *  of burst sessions must not carry a name whose usual day is dead, which is the same reason the
 *  liquidity gate reads it. Absent when the window held no usable session: a name that traded
 *  nothing is a measured zero, and a name the bars refresh has not reached is neither. */
export function medianTurnover(bars: readonly BarRecord[], sessions: number): number | undefined {
  return median(windowValues(bars, sessions))
}

/** The window's total spread over its sessions, for a ratio that is about how much stock changed
 *  hands rather than about what a normal day looks like. Absent when the window held no usable
 *  session, like `medianTurnover`: no reading is not a measured zero. */
export function averageTurnover(bars: readonly BarRecord[], sessions: number): number | undefined {
  const values = windowValues(bars, sessions)

  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length
}

/** A session with no trades is zero turnover, not a missing reading: counting it in the divisor is
 *  what keeps a name that printed once from averaging like one that trades every day. */
function windowValues(bars: readonly BarRecord[], sessions: number): readonly number[] {
  return bars
    .slice(-sessions)
    .map(barTurnover)
    .filter((value): value is number => value !== undefined)
}
