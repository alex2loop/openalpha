import type { FactorResult } from '@/trading/kernel/factor'
import type { InstrumentRequest } from '@/trading/kernel/market/market-capability'
import type { FundingSnapshot } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { TradingCalendar } from '@/trading/markets/types'
import { available } from '@/trading/kernel/source/source-result'
import { lastSettledDay } from '@/trading/markets/bars'
import { CRYPTO_MARKET_REF } from '@/trading/markets/crypto/policy'

/** The daily funding rate a factor row carries, percent-valued. */
export function fundingDailyOf(
  rows: readonly Pick<FactorResult, 'id' | 'metrics'>[]
): number | undefined {
  return rows
    .find((row) => row.id === 'funding')
    ?.metrics?.find((metric) => metric.id === 'funding-daily')?.value
}

/** The settled-day reading, like every other input, bounded to `asOf` so a stored row and a live
 *  one never disagree about what they measured. The refresh does not warm this: the snapshot is a
 *  fold the provider recomputes for any day, and its readers are the handful of names a screen
 *  examines, so the first read of a day fills the row every later read answers from. */
export async function cryptoFunding(
  deps: MarketDeps,
  request: InstrumentRequest,
  calendar: TradingCalendar
): Promise<SourceResult<FundingSnapshot>> {
  const asOf = lastSettledDay(request, calendar)
  const stored = await deps.marketDataStore.findFunding({
    instrument: request.instrument,
    asOf,
    signal: request.signal,
  })

  if (stored !== null) {
    return available(
      stored,
      [{ sourceId: stored.sourceId, fetchedAt: stored.fetchedAt, freshness: 'cached' }],
      []
    )
  }

  const live = await deps.sources.resolve({
    kind: 'funding',
    context: { market: CRYPTO_MARKET_REF, instrument: request.instrument, toDay: asOf },
    signal: request.signal,
  })

  if (live.kind === 'available') {
    await deps.marketDataStore.upsertFunding([live.value], request.signal)
  }

  return live
}
