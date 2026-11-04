import type { App } from '@/core/container'
import type { RequestShape } from '@/core/http-client'
import type { CaveatCode } from '@/trading/kernel/caveat'
import type { TradingConfig } from '@/trading/kernel/config'
import type { FxRates } from '@/trading/kernel/market/fx-rates'
import type { SourceKind, SourceKindMap, SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { StageRegistry } from '@/trading/markets/stage'
import type { MarketRegistry, ResolveSourceOptions, SourceRegistry } from '@/trading/markets/types'
import type { LoadedSourceModule } from '@/trading/sources/plugin-module'
import type { SourceRouteTable } from '@/trading/sources/routes'
import type { HostSourceFacts } from '@/trading/sources/types'
import type { VenueRegistry } from '@/trading/venues/types'
import type { TradingEdition } from '@/trading/wiring/composition/edition'
import { SOURCES_COMMAND_NAME } from '@/trading/features/market-data/command/sources'
import { createFxRates } from '@/trading/features/market-data/reads/fx'
import { createAdmissionStage } from '@/trading/features/suggestion/pipeline/admission'
import { createAveragingDownStage } from '@/trading/features/suggestion/pipeline/averaging-down'
import { createDeploymentStage } from '@/trading/features/suggestion/pipeline/deployment'
import { createExclusionStage } from '@/trading/features/suggestion/pipeline/exclusion'
import { createRoundTripStage } from '@/trading/features/suggestion/pipeline/round-trip'
import { createStageRegistry } from '@/trading/features/suggestion/pipeline/stage-registry'
import { WITHOUT_SOURCES_DETAIL } from '@/trading/kernel/caveat'
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

/** What the registries read of the registration's options, named here so the registration need not
 *  export its own. */
interface RegistryOptions {
  readonly tradingConfig: TradingConfig
  readonly env: Readonly<Record<string, string | undefined>>
  readonly pluginModules: readonly LoadedSourceModule[]
  readonly requestShape: RequestShape
  readonly routes?: SourceRouteTable
  readonly sourceFacts?: HostSourceFacts
  readonly edition?: TradingEdition
}

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
export function buildRegistries(app: App, options: RegistryOptions): Registries {
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
    ...editionMarketDeps(options.edition),
    briefServices: lazyBriefServices(app, options.tradingConfig, {
      venues,
      // The book's `stopDistances` answers [] ("measured, none set"); the brief takes undefined
      // for "no stop read at all", so a section states no stop instead of one per losing name.
      ...(options.edition?.reads === undefined
        ? {}
        : { reads: { ...options.edition.reads.brief, stopDistances: async () => undefined } }),
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

/** What an edition changes in what every market is handed; absent is the installed version. */
function editionMarketDeps(
  edition: TradingEdition | undefined
): Pick<MarketDeps, 'pagedBackfill' | 'omitRefreshKinds' | 'omitBriefActions' | 'unservedMacro'> {
  return {
    ...(edition?.pagedBackfill === true ? { pagedBackfill: true as const } : {}),
    ...(edition?.refreshOmits === undefined ? {} : { omitRefreshKinds: edition.refreshOmits }),
    ...(edition?.macroUnserved === undefined
      ? {}
      : {
          unservedMacro: Object.fromEntries(
            [...edition.macroUnserved].map((id) => [id, 'unserved'])
          ),
        }),
    ...(edition?.briefActionOmits === undefined
      ? {}
      : { omitBriefActions: edition.briefActionOmits }),
  }
}

function buildSources(app: App, options: RegistryOptions): SourceRegistry {
  const logger = app.resolve('logger')
  const stores = app.resolve('tradingStores')

  const registry = withNewsArchive(
    createConfiguredSourceRegistry({
      env: options.env,
      logger,
      pluginModules: options.pluginModules,
      credentialEnv: options.tradingConfig.sourceCredentialEnv,
      defaultVenues: options.tradingConfig.defaultVenues,
      macroReads: stores.marketData,
      requestShape: options.requestShape,
      routes: options.routes,
      facts: options.sourceFacts,
    }),
    { archive: stores.newsArchive, logger }
  )

  return options.edition?.commands?.has(SOURCES_COMMAND_NAME) === false
    ? withoutSourcesPointer(registry)
    : registry
}

/** The outage notes whose sentence ends by sending the reader to `/sources`. */
const SOURCES_POINTER_CODES: ReadonlySet<CaveatCode> = new Set([
  'source.unavailable',
  'source.breaker-open',
])

function unpointed<T>(result: SourceResult<T>): SourceResult<T> {
  return {
    ...result,
    caveats: result.caveats.map((caveat) =>
      SOURCES_POINTER_CODES.has(caveat.code)
        ? { ...caveat, detail: { ...caveat.detail, ...WITHOUT_SOURCES_DETAIL } }
        : caveat
    ),
  }
}

/** For an edition with no `/sources`: every outage note a read carries is marked, so its sentence
 *  leaves the pointer out. Every read in every market passes through the registry, so marking here
 *  needs no caller to remember it. */
function withoutSourcesPointer(registry: SourceRegistry): SourceRegistry {
  return Object.freeze({
    ...registry,
    async resolve<K extends SourceKind>(
      options: ResolveSourceOptions<K>
    ): Promise<SourceResult<SourceKindMap[K]>> {
      return unpointed(await registry.resolve(options))
    },
    async resolveAll<K extends SourceKind>(
      options: ResolveSourceOptions<K>
    ): Promise<readonly SourceResult<SourceKindMap[K]>[]> {
      return (await registry.resolveAll(options)).map(unpointed)
    },
  })
}
