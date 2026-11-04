import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { ScheduledRunner } from '@/core/types/command'
import type { BriefDelivery } from '@/trading/features/brief/types'
import type { RefreshMarketData } from '@/trading/features/market-data/ops/refresh'
import type { ProfileService } from '@/trading/features/profile/types'
import type { RestatementDeps } from '@/trading/features/suggestion/exit-plan/restatement'
import type { MarketRef } from '@/trading/kernel/instrument'
import type {
  RefreshAllMarketDataOptions,
  RefreshMarketDataResult,
} from '@/trading/kernel/market/refresh'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { MarketRegistry } from '@/trading/markets/types'
import type { createTradeableBook } from '@/trading/wiring/composition/delivery-reads'
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
  readonly stores: Pick<TradingStores, 'suggestion' | 'briefDelivery'>
  readonly book: ReturnType<typeof createTradeableBook>
  /** The resolved profile, stored or seeded: a segment the stored one never named is off, so a book
   *  from before a market existed does not start refreshing it. */
  readonly profiles: Pick<ProfileService, 'get'>
}

function briefMarket(markets: MarketRegistry, brief: BriefDelivery | null): MarketRef[] {
  const market =
    brief === null || brief.state === 'disabled' ? null : markets.regionOwner(brief.region)

  return market === null ? [] : [market.manifest.id]
}

interface BuiltRefreshCoordinator {
  readonly refresh: RefreshMarketData
  /** Written by the coordinator alone; `ensure` reads it. */
  readonly firstLoading: ReadonlySet<MarketRef>
}

/** Every refresh path closes the plans a rebuilt series invalidated: only the pass that rebuilt it
 *  reports the rebuild. A caller that joined that pass repeats the close and finds nothing open. */
export function buildRefreshCoordinator(
  app: App,
  notice: RestatementNotice,
  markets: MarketRegistry
): BuiltRefreshCoordinator {
  const stores = app.resolve('tradingStores')
  const restatement: RestatementDeps = {
    suggestions: stores.suggestion,
    sender: notice.sender,
    recipient: () => notice.recipient(),
    logger: app.resolve('logger'),
    defaultLocale: app.config.locale.language,
  }
  const firstLoading = new Set<MarketRef>()
  const coordinator = createRefreshCoordinator({
    markets,
    marketDataStore: stores.marketData,
    newsArchive: stores.newsArchive,
    universeLimit: UNIVERSE_REFRESH_LIMIT,
    firstLoading,
    logger: restatement.logger,
  })

  return {
    firstLoading,
    refresh: async (options) => {
      const result = await coordinator(options)

      await clearRestatedPlans(restatement, result, options.signal)

      return result
    },
  }
}

interface RefreshTickParts {
  readonly markets: MarketRegistry
  readonly stores: TradingStores
  readonly inUse: MarketsInUseDeps
  readonly refresh: RefreshMarketData
  readonly logger: Logger
}

interface ScheduledRuns {
  readonly runScheduled: ScheduledRunner
}

/** Built after the services: the trade-sides sweep it carries reads the book. */
export function buildRefreshTick(
  scheduled: ScheduledRuns,
  parts: RefreshTickParts
): (options: RefreshAllMarketDataOptions) => Promise<readonly RefreshMarketDataResult[]> {
  const { markets, stores, logger } = parts

  return createRefreshTick({
    refresh: parts.refresh,
    markets: resolveRefreshMarkets(markets),
    inUse: (signal) => resolveMarketsInUse(parts.inUse, signal),
    recordTradeSides: createTradeSidesTick({
      profiles: stores.profile,
      book: parts.inUse.book,
      markets,
      marketDataStore: stores.marketData,
      logger,
    }),
    runScheduled: scheduled.runScheduled,
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
 *  switched-off segment drops out only once none of those needs its prices. With no profile saved
 *  the seeded one decides, so a fresh install refreshes only the segments its home market seeds. */
export async function resolveMarketsInUse(
  deps: MarketsInUseDeps,
  signal: AbortSignal
): Promise<ReadonlySet<MarketRef>> {
  const all = deps.markets.list()
  const [profile, positions, coverage, brief] = await Promise.all([
    deps.profiles.get({ signal }),
    deps.book.tradeableHoldingsAt({ now: Date.now(), signal }),
    deps.stores.suggestion.coverage({ signal }),
    deps.stores.briefDelivery.find(signal),
  ])

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
