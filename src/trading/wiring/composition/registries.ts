import type { App } from '@/core/container'
import type { FxRates } from '@/trading/kernel/market/fx-rates'
import type { MarketDeps } from '@/trading/markets/deps'
import type { StageRegistry } from '@/trading/markets/stage'
import type { MarketRegistry, SourceRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import type { BoundOptions } from '@/trading/wiring/composition/registration-options'
import { createFxRates } from '@/trading/features/market-data/reads/fx'
import { createAdmissionStage } from '@/trading/features/suggestion/pipeline/admission'
import { createAveragingDownStage } from '@/trading/features/suggestion/pipeline/averaging-down'
import { createDeploymentStage } from '@/trading/features/suggestion/pipeline/deployment'
import { createExclusionStage } from '@/trading/features/suggestion/pipeline/exclusion'
import { createRoundTripStage } from '@/trading/features/suggestion/pipeline/round-trip'
import { createStageRegistry } from '@/trading/features/suggestion/pipeline/stage-registry'
import { createCryptoMarket } from '@/trading/markets/crypto/market'
import { createUsEquityMarket } from '@/trading/markets/equity-us/market'
import { createVnEquityMarket } from '@/trading/markets/equity-vn/market'
import { createGoldMarket } from '@/trading/markets/gold/market'
import { createVnGoldMarket } from '@/trading/markets/gold-vn/market'
import { macroCache } from '@/trading/markets/macro-cache'
import { createMarketRegistry } from '@/trading/markets/registry'
import { lazyBriefServices } from '@/trading/wiring/composition/brief-services'
import { isMarketBuilt } from '@/trading/wiring/composition/edition'
import { lazyHeldInstruments } from '@/trading/wiring/composition/held-instruments'
import { withNewsArchive } from '@/trading/wiring/composition/news-archive'
import { createConfiguredSourceRegistry } from '@/trading/wiring/composition/source-registry'
import { buildVenues } from '@/trading/wiring/composition/venues'

export interface Registries {
  readonly markets: MarketRegistry
  readonly sources: SourceRegistry
  readonly stages: StageRegistry
  readonly venues: VenueRegistry
  /** Not a registry, but built here: the markets read rates through the same path the ledger and
   *  the portfolio do, so one outage cannot leave a book converted and a brief unconverted. */
  readonly fx: FxRates
}

const MARKET_FACTORIES = [
  createGoldMarket,
  createVnGoldMarket,
  createVnEquityMarket,
  createUsEquityMarket,
  createCryptoMarket,
] as const

/** Created and closed once, inside the lazy factory. Nothing above this function ever sees a
 *  registry, mutable or otherwise. */
export function buildRegistries(app: App, options: BoundOptions): Registries {
  const logger = app.resolve('logger')
  const stores = app.resolve('tradingStores')
  const sources = buildSources(app, options)
  const stages = createStageRegistry()
  const markets = createMarketRegistry(lazyHeldInstruments(app, logger))
  const { registry: venues, listings } = buildVenues(options, { logger, book: stores.ledger })
  const fx = createFxRates({ sources, store: stores.fxRate, logger })
  const deps: MarketDeps = {
    config: options.tradingConfig,
    sources,
    fx,
    marketDataStore: stores.marketData,
    macro: macroCache(sources),
    stages,
    venueListings: listings,
    briefServices: lazyBriefServices(app, options.tradingConfig, {
      venues,
      ...(options.edition?.reads === undefined ? {} : { reads: options.edition.reads.brief }),
    }),
  }

  stages.register(createAdmissionStage())
  stages.register(createExclusionStage())
  stages.register(createDeploymentStage())
  stages.register(createAveragingDownStage())
  stages.register(createRoundTripStage())

  for (const create of MARKET_FACTORIES) {
    const market = create(deps)

    if (isMarketBuilt(options.edition, market.manifest.id)) {
      markets.register(market)
    }
  }

  markets.close()
  stages.close()

  return { markets, sources, stages, venues, fx }
}

function buildSources(app: App, options: BoundOptions): SourceRegistry {
  const logger = app.resolve('logger')
  const stores = app.resolve('tradingStores')

  return withNewsArchive(
    createConfiguredSourceRegistry({
      env: options.env,
      logger,
      pluginModules: options.pluginModules,
      credentialEnv: options.tradingConfig.sourceCredentialEnv,
      defaultVenues: options.tradingConfig.defaultVenues,
      macroReads: stores.marketData,
      requestShape: options.requestShape,
      routes: options.routes,
      plainUserAgentSources: options.plainUserAgentSources,
      feeds: options.feeds,
    }),
    { archive: stores.newsArchive, logger }
  )
}
