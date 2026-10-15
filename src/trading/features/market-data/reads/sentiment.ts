import type { MarketDataRunDeps } from '@/trading/features/market-data/market-data-run'
import type { MarketDataMarketRequest } from '@/trading/features/market-data/types'
import type { SentimentSnapshot } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import { requireMarket } from '@/trading/features/market-data/market-data-run'
import { resolveDay, unsupportedCapability } from '@/trading/features/market-data/resolve'

export async function runSentiment(
  deps: MarketDataRunDeps,
  options: MarketDataMarketRequest
): Promise<SourceResult<SentimentSnapshot>> {
  const market = requireMarket(deps, options.market)

  return (
    (await market.capabilities.sentiment?.run({
      asOf: resolveDay(market, options.now),
      now: options.now,
      signal: options.signal,
    })) ?? unsupportedCapability()
  )
}
