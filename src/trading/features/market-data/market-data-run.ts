import type { Logger } from '@/core/logging/logger'
import type {
  EnsureMarketData,
  EnsureMarketDataOptions,
} from '@/trading/features/market-data/ops/refresh'
import type {
  MarketDataPerMarketRequest,
  MarketDataRequest,
} from '@/trading/features/market-data/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type { MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { mapSourceValue } from '@/trading/kernel/source/source-result'

export interface MarketDataRunDeps {
  readonly logger: Logger
  readonly markets: MarketRegistry
  readonly config: TradingConfig
  readonly ensure: EnsureMarketData
}

/** Every read warms the market it is about before answering, and forwards the reporter the surface
 *  gave it so a first warm is visible rather than a silent wait. */
export function buildEnsureOptions(
  market: MarketRef,
  request: MarketDataRequest
): EnsureMarketDataOptions {
  return {
    market,
    now: request.now,
    signal: request.signal,
    ...(request.progress === undefined ? {} : { progress: request.progress }),
  }
}

/** An explicit market ref is a caller error when it names nothing registered, not a data
 *  unavailability: the capability results below have an unavailable arm, but `overview` and
 *  `screen` do not, so this is the one place a bad ref is rejected outright. */
export function requireMarket(deps: MarketDataRunDeps, ref: MarketRef): Market {
  const market = deps.markets.find(ref)

  if (market === null) {
    const registered = deps.markets
      .list()
      .map((candidate) => candidate.manifest.id)
      .join(', ')

    throw new ValidationError(`market is not registered: ${ref}; registered: ${registered}`)
  }

  return market
}

export function requestedMarkets(
  registry: MarketRegistry,
  options: MarketDataPerMarketRequest
): readonly Market[] {
  const { markets } = options

  return registry
    .list()
    .filter((market) => markets === undefined || markets.includes(market.manifest.id))
}

export function withinRange<T>(
  result: SourceResult<readonly T[]>,
  range: { readonly fromDay: TradingDay; readonly toDay: TradingDay },
  dayOf: (item: T) => TradingDay
): SourceResult<readonly T[]> {
  const { fromDay, toDay } = range

  return mapSourceValue(result, (items) =>
    items.filter((item) => dayOf(item) >= fromDay && dayOf(item) <= toDay)
  )
}
