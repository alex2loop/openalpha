import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { RefreshMarketData } from '@/trading/features/market-data/ops/refresh'
import type { ProfileService } from '@/trading/features/profile/types'
import type { MarketRegistry, SourceRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import type { TradingStores } from '@/trading/wiring/composition/stores'
import { marketRef } from '@/trading/kernel/instrument'
import { createTradeableBook } from '@/trading/wiring/composition/delivery-reads'
import { buildMacroExtractTick } from '@/trading/wiring/composition/macro-extract'
import {
  buildRefreshTick,
  type RefreshHost,
  resolveMarketsInUse,
} from '@/trading/wiring/composition/refresh'

interface MarketTicks {
  readonly inUse: Parameters<typeof resolveMarketsInUse>[0]
  readonly refreshMarketData: ReturnType<typeof buildRefreshTick>
  readonly macroExtractTick: ReturnType<typeof buildMacroExtractTick>
}

interface MarketTickParts {
  readonly registries: {
    readonly markets: MarketRegistry
    readonly sources: SourceRegistry
    readonly venues: VenueRegistry
  }
  readonly stores: TradingStores
  readonly services: {
    readonly portfolio: Parameters<typeof createTradeableBook>[0]['portfolio']
    readonly profiles: Pick<ProfileService, 'get'>
  }
  readonly refresh: RefreshMarketData
  readonly host: RefreshHost
  readonly logger: Logger
}

/** What decides a market is in use is the resolved profile; the market-data sweep and the
 *  Vietnamese statistics reader both ask it, so neither reaches for a market the operator never
 *  chose. */
export function buildMarketTicks(app: App, parts: MarketTickParts): MarketTicks {
  const { registries, stores, services } = parts
  const inUse = {
    markets: registries.markets,
    stores,
    book: createTradeableBook({ portfolio: services.portfolio, venues: registries.venues }),
    profiles: services.profiles,
  }

  return {
    inUse,
    refreshMarketData: buildRefreshTick(parts.host, {
      markets: registries.markets,
      stores,
      inUse,
      refresh: parts.refresh,
      logger: parts.logger,
    }),
    macroExtractTick: buildMacroExtractTick(app, registries.sources, async (signal) =>
      (await resolveMarketsInUse(inUse, signal)).has(marketRef('equity-vn'))
    ),
  }
}
