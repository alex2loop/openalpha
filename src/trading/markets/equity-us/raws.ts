import type { BarRecord } from '@/trading/kernel/market/market-data'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import {
  US_MOMENTUM_SESSIONS,
  US_MOMENTUM_SKIP_SESSIONS,
  US_VOLATILITY_SESSIONS,
} from '@/trading/markets/equity-us/policy'
import { nSessionReturn, realizedVolatility } from '@/trading/markets/timeseries'

/** What a name's own price path says; value and quality are read from its accounts. */
export interface UsRaws {
  readonly momentum?: number
  readonly volatility?: number
}

/** Twelve months of return less the latest one, and the volatility of the last quarter. */
export function usRawsOf(closes: readonly number[]): UsRaws {
  const momentum = nSessionReturn(
    closes.slice(0, Math.max(closes.length - US_MOMENTUM_SKIP_SESSIONS, 0)),
    US_MOMENTUM_SESSIONS
  )
  const volatility = realizedVolatility(closes, US_VOLATILITY_SESSIONS)

  return {
    ...(momentum === undefined ? {} : { momentum }),
    ...(volatility === undefined ? {} : { volatility }),
  }
}

export function usBarProvenance(bars: readonly BarRecord[]): readonly SourceProvenance[] {
  const newest = bars.at(-1)

  return newest === undefined
    ? []
    : [{ sourceId: newest.sourceId, fetchedAt: newest.fetchedAt, freshness: 'cached' }]
}
