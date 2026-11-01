import type { TradingConfig } from '@/trading/kernel/config'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { VenueRegistry } from '@/trading/venues/types'
import { cashDrawMultiple, marketTradeCost } from '@/trading/markets/cost'

interface BuyCashDeps {
  readonly config: TradingConfig
  readonly venues: VenueRegistry
}

/** What a buy in the market draws from cash per unit of notional. Price drift counts only where the
 *  default venue places orders: a hand-traded market is bought at the typed price, and the order
 *  cap never sees it. */
export function buyCashMultipleOf(deps: BuyCashDeps, market: MarketRef): number {
  const { config } = deps
  const venue = config.defaultVenues[market]
  const placesOrders =
    venue !== undefined && deps.venues.find(venue)?.manifest.acceptsOrders === true

  return cashDrawMultiple(
    marketTradeCost(config, market),
    placesOrders ? config.orders.maximumPriceDrift : 0
  )
}
