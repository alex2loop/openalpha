import type { MarketDataRunDeps } from '@/trading/features/market-data/market-data-run'
import type {
  MarketDataIndexRequest,
  MarketDataService,
} from '@/trading/features/market-data/types'
import type {
  IndexContributorsReading,
  IndexValuationReading,
} from '@/trading/kernel/market/index-reading'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import { requireMarket } from '@/trading/features/market-data/market-data-run'
import { resolveDay, unsupportedCapability } from '@/trading/features/market-data/resolve'

async function runIndexContributors(
  deps: MarketDataRunDeps,
  options: MarketDataIndexRequest
): Promise<SourceResult<IndexContributorsReading>> {
  const market = requireMarket(deps, options.market)

  return (
    (await market.capabilities.indexContributors?.run({
      asOf: resolveDay(market, options.now),
      index: options.index,
      now: options.now,
      signal: options.signal,
    })) ?? unsupportedCapability()
  )
}

async function runIndexValuation(
  deps: MarketDataRunDeps,
  options: MarketDataIndexRequest
): Promise<SourceResult<IndexValuationReading>> {
  const market = requireMarket(deps, options.market)

  return (
    (await market.capabilities.indexValuation?.run({
      asOf: resolveDay(market, options.now),
      index: options.index,
      now: options.now,
      signal: options.signal,
    })) ?? unsupportedCapability()
  )
}

export function indexReads(
  deps: MarketDataRunDeps
): Pick<MarketDataService, 'indexContributors' | 'indexValuation'> {
  return {
    indexContributors: (options) => runIndexContributors(deps, options),
    indexValuation: (options) => runIndexValuation(deps, options),
  }
}
