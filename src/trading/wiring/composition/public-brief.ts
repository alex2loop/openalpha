import type { Logger } from '@/core/logging/logger'
import type {
  BuiltPublicBriefRow,
  PublicBriefDeps,
  PublicBriefRender,
  PublicBriefStore,
} from '@/trading/features/brief/public/types'
import type { ScreenRowForm } from '@/trading/features/market-data/render/screen-evidence'
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
import { runBookFreeScreen } from '@/trading/features/market-data/ops/book-free-screen'
import { renderScreenRows } from '@/trading/features/market-data/render/screen-evidence'
import { defaultProfile, toSegmentDescriptors } from '@/trading/features/profile/policy'

/** A name's rank and score and its price: no verdict, no operator mark, no factor reading. */
const PUBLIC_ROW_FORM: ScreenRowForm = Object.freeze({ rated: false, factors: false })

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
          topScreen: config.publicBrief.topScreen,
          logger: parts.logger,
          refresh: (options) => parts.refreshMarketData(options),
          screen: (request) => readScreen(parts, home().manifest.calendar.timezone, request),
        },
        input
      ),
    // The VPS is often on UTC: the brief is dated and timed on the Vietnam calendar.
    render: (row) => renderPublicBrief(row, { timezone: home().manifest.calendar.timezone }),
  }
}

/** The lists are timed on the brief's clock, as the rest of it is. */
async function readScreen(
  parts: PublicBriefParts,
  timezone: string,
  request: Parameters<PublicBriefDeps['screen']>[0]
): ReturnType<PublicBriefDeps['screen']> {
  const view = await runBookFreeScreen({ markets: parts.markets, logger: parts.logger }, request)

  if (view === undefined || view.candidates.length === 0) {
    return undefined
  }

  const clocked = { ...view, timezone }

  return {
    asOf: view.dataThroughDay ?? view.asOf,
    rows: {
      en: renderScreenRows('en', clocked, PUBLIC_ROW_FORM),
      vi: renderScreenRows('vi', clocked, PUBLIC_ROW_FORM),
    },
    provenance: view.provenance,
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
