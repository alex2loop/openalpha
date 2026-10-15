import type { LevelRequest, RestingEntryRule } from '@/trading/kernel/factor'
import type { TradingDay } from '@/trading/kernel/instrument'
import { nSessionReturn } from '@/trading/markets/timeseries'

export interface RestingEntryPrice {
  readonly entry: number
  readonly run: number
  readonly runSessions: number
  readonly validSessions: number
}

/** Only a buy priced at a live quote rests: with no quote the entry is already a settled close, and
 *  a limit under it would be priced off a session that has finished. A price the operator was
 *  actually filled at carries no quote session either, and is a fact that cannot be moved. */
export function restingEntryOf(
  request: Pick<LevelRequest, 'candles' | 'direction' | 'entry'> & {
    readonly rule: RestingEntryRule | undefined
    readonly entrySession: TradingDay | undefined
    readonly atr: number
  }
): RestingEntryPrice | undefined {
  const { rule, entry } = request

  if (
    rule === undefined ||
    request.direction !== 'buy' ||
    entry === undefined ||
    request.entrySession === undefined
  ) {
    return undefined
  }

  const run = nSessionReturn(
    request.candles.map((candle) => candle.close),
    rule.runSessions
  )

  if (run === undefined || run < rule.minimumRun) {
    return undefined
  }

  const resting = entry - rule.atrOffset * request.atr

  return resting > 0
    ? { entry: resting, run, runSessions: rule.runSessions, validSessions: rule.validSessions }
    : undefined
}
