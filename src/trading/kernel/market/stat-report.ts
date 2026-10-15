import type { TradingDay } from '@/trading/kernel/instrument'
import type { SourceStamp } from '@/trading/kernel/market/market-data'

/** One statistics office report as plain text; `period` is the last day of the month it covers. */
export interface StatReport extends SourceStamp {
  readonly period: TradingDay
  readonly url: string
  readonly text: string
}
