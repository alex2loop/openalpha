import type { Logger } from '@/core/logging/logger'
import type {
  BuiltPublicBriefRow,
  PublicBriefRender,
  PublicBriefStore,
} from '@/trading/features/brief/public/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type { TradingDay } from '@/trading/kernel/instrument'
import type {
  RefreshAllMarketDataOptions,
  RefreshMarketDataResult,
} from '@/trading/kernel/market/refresh'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { ValidationError } from '@/core/errors'
import { buildPublicBrief } from '@/trading/features/brief/public/build'
import { createPublicBriefReads, PUBLIC_HOME_MARKET } from '@/trading/features/brief/public/reads'
import { renderPublicBrief } from '@/trading/features/brief/public/render'
import { defaultProfile, toSegmentDescriptors } from '@/trading/features/profile/policy'

interface PublicBriefParts {
  readonly config: TradingConfig
  readonly markets: MarketRegistry
  readonly venues: VenueRegistry
  readonly marketData: MarketDataService
  readonly store: PublicBriefStore
  readonly logger: Logger
  refreshMarketData(
    options: RefreshAllMarketDataOptions
  ): Promise<readonly RefreshMarketDataResult[]>
}

/** The public brief, built from reads that hold no book: the market data service, its own store and
 *  a seeded default profile. Nothing the operator holds, watches or has switched off reaches it. */
export interface PublicBrief {
  build(input: {
    readonly day: TradingDay
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<BuiltPublicBriefRow | null>
  render(row: BuiltPublicBriefRow): PublicBriefRender
}

export function createPublicBrief(parts: PublicBriefParts): PublicBrief {
  const { config, markets, store } = parts
  const reads = createPublicBriefReads({
    marketData: parts.marketData,
    store,
    profile: defaultProfile({
      baseCurrency: config.baseCurrency,
      segments: toSegmentDescriptors(
        markets.list().map(({ manifest }) => manifest),
        { heldMarkets: parts.venues.heldMarkets(), homeRegion: config.defaultRegion }
      ),
    }),
  })
  const home = (): Market => homeMarket(markets)

  return {
    build: (input) =>
      buildPublicBrief(
        {
          market: home(),
          reads,
          store,
          toggles: config.publicBrief,
          limit: config.briefs.maximumItemsPerSection,
          logger: parts.logger,
          refresh: (options) => parts.refreshMarketData(options),
        },
        input
      ),
    // The VPS is often on UTC: the brief is dated and timed on the Vietnam calendar.
    render: (row) => renderPublicBrief(row, { timezone: home().manifest.calendar.timezone }),
  }
}

function homeMarket(markets: MarketRegistry): Market {
  const market = markets.find(PUBLIC_HOME_MARKET)

  if (market === null) {
    throw new ValidationError(
      `no registered market ${PUBLIC_HOME_MARKET} composes the public brief`
    )
  }

  return market
}
