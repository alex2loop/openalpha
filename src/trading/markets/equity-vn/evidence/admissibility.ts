import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { Candle, FlowSnapshot } from '@/trading/kernel/market/market-data'
import { isSameInstrument } from '@/trading/kernel/instrument'

/** The window a payload was asked for. A provider answering outside it is a mismatch, not a short
 *  answer, so the rows are rejected whole rather than filtered down to the part that fits. */
export interface DayWindow {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

export function admissibleCandles(
  candles: readonly Candle[],
  window: DayWindow
): readonly Candle[] | null {
  const days = new Set<TradingDay>()

  for (const candle of candles) {
    if (candle.at < window.fromDay || candle.at > window.toDay || days.has(candle.at)) {
      return null
    }

    days.add(candle.at)
  }

  return candles
}

export function isAdmissibleFlows(
  rows: readonly FlowSnapshot[],
  instrument: InstrumentRef,
  window: DayWindow
): boolean {
  const keys = new Set<string>()

  for (const row of rows) {
    const key = `${row.at}|${row.sourceId}`

    if (!isSameInstrument(row.instrument, instrument) || keys.has(key)) {
      return false
    }

    if (row.at < window.fromDay || row.at > window.toDay) {
      return false
    }

    keys.add(key)
  }

  return true
}
