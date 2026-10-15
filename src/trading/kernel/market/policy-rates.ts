import type { TradingDay } from '@/trading/kernel/instrument'
import type { SourceStamp } from '@/trading/kernel/market/market-data'

export const INTERBANK_TENORS = Object.freeze(['overnight', '1w', '1m', '3m'] as const)
export type InterbankTenor = (typeof INTERBANK_TENORS)[number]

/** The policy rates carry no day of their own (the page states only when each last changed), so a
 *  reader stamps them with the day it read them; the interbank averages carry the page's day. */
export interface PolicyRateSnapshot extends SourceStamp {
  readonly refinancingPct: number
  readonly rediscountPct: number
  readonly interbankDay: TradingDay
  readonly interbankPct: Readonly<Partial<Record<InterbankTenor, number>>>
}

export const REFINANCING_SERIES_ID = 'vn-refinancing-rate'
export const REDISCOUNT_SERIES_ID = 'vn-rediscount-rate'

export function interbankSeriesId(tenor: InterbankTenor): string {
  return `vn-interbank-${tenor}`
}
