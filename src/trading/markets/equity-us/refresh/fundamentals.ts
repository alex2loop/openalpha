import type { Ticker } from '@/trading/kernel/instrument'
import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketDataRefreshRequest } from '@/trading/markets/types'
import { createRefreshProgress } from '@/trading/kernel/market/refresh'
import { US_MARKET_REF, US_SCREEN_RANK_BUFFER } from '@/trading/markets/equity-us/policy'
import { emptyKindResult, toKindResult } from '@/trading/markets/refresh-result'

interface FundamentalsOptions {
  readonly universe: readonly InstrumentRecord[]
  readonly request: MarketDataRefreshRequest
}

/** One live read answers every equity; only the largest by capitalisation are stored, because a
 *  snapshot is kept for every day it is written and the screen reads no others. That bounds the
 *  store's growth to the kept set a day, however many names the listing holds. */
export async function refreshUsFundamentals(
  deps: MarketDeps,
  options: FundamentalsOptions
): Promise<RefreshKindResult> {
  const { request } = options

  createRefreshProgress(request.progress, { market: US_MARKET_REF, kind: 'fundamentals' }, 1)

  const result = await deps.sources.resolve({
    kind: 'fundamentals',
    context: { market: US_MARKET_REF, toDay: request.asOf },
    signal: request.signal,
  })

  if (result.kind === 'unavailable') {
    return emptyKindResult('fundamentals', 'unavailable', result.caveats)
  }

  const listed = new Set<Ticker>(
    options.universe
      .filter((record) => record.status === 'active' && record.kind === 'equity')
      .map((record) => record.instrument.ticker)
  )
  const kept = result.value
    .filter((snapshot) => listed.has(snapshot.instrument.ticker))
    .sort((left, right) => (right.marketCap ?? 0) - (left.marketCap ?? 0))
    .slice(0, US_SCREEN_RANK_BUFFER)

  await deps.marketDataStore.upsertFundamentals(kept, request.signal)

  return toKindResult({
    kind: 'fundamentals',
    successStatus: 'upserted',
    outcomes: kept.map((snapshot) => ({
      instrument: snapshot.instrument,
      value: snapshot,
      provenance: result.provenance,
      caveats: [],
    })),
    recordCount: kept.length,
    caveats: result.caveats,
  })
}
