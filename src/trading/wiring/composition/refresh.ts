import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { BriefDelivery } from '@/trading/features/brief/types'
import type { RefreshMarketData } from '@/trading/features/market-data/ops/refresh'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { RestatementDeps } from '@/trading/features/suggestion/exit-plan/restatement'
import type { MarketRef } from '@/trading/kernel/instrument'
import type {
  RefreshAllMarketDataOptions,
  RefreshMarketDataResult,
} from '@/trading/kernel/market/refresh'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { MarketRegistry } from '@/trading/markets/types'
import type { TradingStores } from '@/trading/wiring/composition/stores'
import {
  createRefreshCoordinator,
  createRefreshTick,
} from '@/trading/features/market-data/ops/refresh'
import { createTradeSidesTick } from '@/trading/features/market-data/ops/trade-sides'
import { clearRestatedPlans } from '@/trading/features/suggestion/exit-plan/restatement'
import { disabledSegments } from '@/trading/kernel/operator/profile'

/** How many names a scheduled universe refresh replaces per market. Bounded here rather than in
 *  operator config: it is what the screen population needs, not a preference. */
const UNIVERSE_REFRESH_LIMIT = 2_000

interface RestatementNotice {
  readonly sender: TradingNoticeSender
  recipient(): DeliveryAddress | undefined
}

interface MarketsInUseDeps {
  readonly markets: MarketRegistry
  readonly stores: Pick<TradingStores, 'profile' | 'suggestion' | 'briefDelivery'>
  readonly portfolio: Pick<PortfolioService, 'positionsAt'>
}

function briefMarket(markets: MarketRegistry, brief: BriefDelivery | null): MarketRef[] {
  const market =
    brief === null || brief.state === 'disabled' ? null : markets.regionOwner(brief.region)

  return market === null ? [] : [market.manifest.id]
}

/** Every refresh path closes the plans a rebuilt series invalidated: only the pass that rebuilt it
 *  reports the rebuild. A caller that joined that pass repeats the close and finds nothing open. */
export function buildRefreshCoordinator(
  app: App,
  notice: RestatementNotice,
  markets: MarketRegistry
): RefreshMarketData {
  const stores = app.resolve('tradingStores')
  const restatement: RestatementDeps = {
    suggestions: stores.suggestion,
    sender: notice.sender,
    recipient: () => notice.recipient(),
    logger: app.resolve('logger'),
    defaultLocale: app.config.locale.language,
  }
  const coordinator = createRefreshCoordinator({
    markets,
    marketDataStore: stores.marketData,
    newsArchive: stores.newsArchive,
    universeLimit: UNIVERSE_REFRESH_LIMIT,
    logger: restatement.logger,
  })

  return async (options) => {
    const result = await coordinator(options)

    await clearRestatedPlans(restatement, result, options.signal)

    return result
  }
}

interface RefreshTickParts {
  readonly markets: MarketRegistry
  readonly stores: TradingStores
  readonly portfolio: Pick<PortfolioService, 'positionsAt'>
  readonly refresh: RefreshMarketData
  readonly logger: Logger
}

/** Built after the services: the trade-sides sweep it carries reads the book. */
export function buildRefreshTick(
  parts: RefreshTickParts
): (options: RefreshAllMarketDataOptions) => Promise<readonly RefreshMarketDataResult[]> {
  const { markets, stores, logger } = parts

  return createRefreshTick({
    refresh: parts.refresh,
    markets: resolveRefreshMarkets(markets),
    inUse: (signal) => resolveMarketsInUse({ markets, stores, portfolio: parts.portfolio }, signal),
    recordTradeSides: createTradeSidesTick({
      profiles: stores.profile,
      portfolio: parts.portfolio,
      markets,
      marketDataStore: stores.marketData,
      logger,
    }),
    logger,
  })
}

/** Every market that can refresh. The command validates its argument against this list, so a
 *  market the registry cannot refresh is never offered; the tick sweeps the ones still in use. */
export function resolveRefreshMarkets(markets: MarketRegistry): readonly MarketRef[] {
  return markets
    .list()
    .filter((market) => market.capabilities.refresh !== undefined)
    .map((market) => market.manifest.id)
}

/** The markets something the operator relies on still reads: a segment switched on, a holding, a
 *  watched name, a call waiting to be scored, or the market a scheduled brief is built on. A
 *  switched-off segment drops out only once none of those needs its prices. With no profile yet
 *  nothing is known to be unused, so every market stays in. */
export async function resolveMarketsInUse(
  deps: MarketsInUseDeps,
  signal: AbortSignal
): Promise<ReadonlySet<MarketRef>> {
  const all = deps.markets.list()
  const [profile, positions, coverage, brief] = await Promise.all([
    deps.stores.profile.find(signal),
    deps.portfolio.positionsAt({ now: Date.now(), signal }),
    deps.stores.suggestion.coverage({ signal }),
    deps.stores.briefDelivery.find(signal),
  ])

  if (profile === null) {
    return new Set(all.map((market) => market.manifest.id))
  }

  const off = disabledSegments(profile.caps)

  return new Set([
    ...all
      .filter((market) => !off.has(market.manifest.segment))
      .map((market) => market.manifest.id),
    ...positions.map((position) => position.instrument.market),
    ...profile.watchlist.map((instrument) => instrument.market),
    ...coverage.filter((row) => row.state === 'pending' && row.count > 0).map((row) => row.market),
    ...briefMarket(deps.markets, brief),
  ])
}
