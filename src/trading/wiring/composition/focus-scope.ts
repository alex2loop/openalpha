import type { MarketRef } from '@/trading/kernel/instrument'
import type { FocusScope } from '@/trading/kernel/operator/focus'
import type { MarketRegistry } from '@/trading/markets/types'

/** What an agent's `[focus]` is validated against: the markets this book trades, and which of
 *  them keep sector data. */
export function toFocusScope(markets: readonly MarketRef[], registry: MarketRegistry): FocusScope {
  return {
    markets,
    hasSectors: (market) => registry.find(market)?.capabilities.sectors !== undefined,
  }
}
