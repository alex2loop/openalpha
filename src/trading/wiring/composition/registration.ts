import type { App, Bind, Extend, ServiceProvider, TaskPassListener } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { ScheduledRunner } from '@/core/types/command'
import type { Hooks } from '@/engine/api'
import type { RefreshMarketData } from '@/trading/features/market-data/ops/refresh'
import type { RoleOutputListener } from '@/trading/features/suggestion/debate/types'
import type { CallScoredNotices } from '@/trading/features/suggestion/track-record/scored-notice'
import type { TradingConfig } from '@/trading/kernel/config'
import type { FxRates } from '@/trading/kernel/market/fx-rates'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type {
  AlertFiredListener,
  OrderFilledListener,
  TradingNoticeSender,
} from '@/trading/kernel/operator/notice'
import type { MarketDeps } from '@/trading/markets/deps'
import type { StageRegistry } from '@/trading/markets/stage'
import type { MarketRegistry, SourceRegistry } from '@/trading/markets/types'
import type { LoadedSourceModule } from '@/trading/sources/plugin-module'
import type { VenueRegistry } from '@/trading/venues/types'
import type {
  KeyValidator,
  TradingContributions,
} from '@/trading/wiring/composition/registry-checks'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import type { TradingStores } from '@/trading/wiring/composition/stores'
import type { WithThemes } from '@/trading/wiring/composition/themes'
import { ConfigError } from '@/core/errors'
import { createConfiguredRunBudget } from '@/engine/api'
import { createFxRates } from '@/trading/features/market-data/reads/fx'
import { createRunDebate } from '@/trading/features/suggestion/debate/debate'
import { toPlaybookLibrary } from '@/trading/features/suggestion/debate/playbook'
import { createAdmissionStage } from '@/trading/features/suggestion/pipeline/admission'
import { createAveragingDownStage } from '@/trading/features/suggestion/pipeline/averaging-down'
import { createDeploymentStage } from '@/trading/features/suggestion/pipeline/deployment'
import { createExclusionStage } from '@/trading/features/suggestion/pipeline/exclusion'
import { createRoundTripStage } from '@/trading/features/suggestion/pipeline/round-trip'
import { createStageRegistry } from '@/trading/features/suggestion/pipeline/stage-registry'
import { DECISIONS_MODEL_TIER } from '@/trading/kernel/config'
import { createCryptoMarket } from '@/trading/markets/crypto/market'
import { createVnEquityMarket } from '@/trading/markets/equity-vn/market'
import { createGoldMarket } from '@/trading/markets/gold/market'
import { createVnGoldMarket } from '@/trading/markets/gold-vn/market'
import { macroCache } from '@/trading/markets/macro-cache'
import { createMarketRegistry } from '@/trading/markets/registry'
import { createVenueListings } from '@/trading/venues/listings'
import { buildTradingAgents, personaVersions } from '@/trading/wiring/catalog/agents'
import { skillVersions, TRADING_SKILLS } from '@/trading/wiring/catalog/skills'
import { toAggregate } from '@/trading/wiring/composition/aggregate'
import { lazyBriefServices } from '@/trading/wiring/composition/brief-services'
import { buildContributions, mergeUniqueByKey } from '@/trading/wiring/composition/contributions'
import { createTradeableBook } from '@/trading/wiring/composition/delivery-reads'
import { bindHostSeams } from '@/trading/wiring/composition/host-seams'
import { buildMacroExtractTick } from '@/trading/wiring/composition/macro-extract'
import { withNewsArchive } from '@/trading/wiring/composition/news-archive'
import { buildRefreshCoordinator, buildRefreshTick } from '@/trading/wiring/composition/refresh'
import {
  assertRegistryConsistency,
  reportOutdatedHolidayTables,
} from '@/trading/wiring/composition/registry-checks'
import { createDomainServices } from '@/trading/wiring/composition/services'
import { createConfiguredSourceRegistry } from '@/trading/wiring/composition/source-registry'
import { createTradingStores } from '@/trading/wiring/composition/stores'
import { buildThemeService } from '@/trading/wiring/composition/themes'
import { buildVenues } from '@/trading/wiring/composition/venues'
import { createTradingHooks } from '@/trading/wiring/profile-context'

/** Only what the container cannot supply. Everything else — the logger, the runner, the locale,
 *  the budget policy — is resolved from `App` inside the lazy factory, so nothing here duplicates
 *  a value the container already owns. */
interface TradingRegistrationOptions {
  readonly tradingConfig: TradingConfig
  /** Injected, never read from `process`: source credentials resolve from named variables the
   *  code owns, so the value reaches the transport without passing through a config object. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Built where it binds, with the app in hand: the sender reads services the container supplies. */
  sender(app: App): TradingNoticeSender
  /** Bound with the app in hand, like the sender: showing a fill needs the bus. */
  onFilled(app: App): OrderFilledListener
  /** Bound with the app in hand: starting a job that waits on an alert needs the scheduler. */
  onAlertFired(app: App): AlertFiredListener
  /** Bound with the app in hand: telling the page an alert pass finished needs the bus. */
  onAlertsChecked(app: App): (at: number) => void
  /** Bound with the app in hand: the page shows each loop's last and next pass. */
  onTaskPass(app: App): TaskPassListener
  /** Bound with the app in hand: the page shows a scheduled refresh as the `/refresh` run. */
  runScheduled(app: App): ScheduledRunner
  /** Bound with the app in hand: the page shows what each debate role said. */
  onRoleOutput(app: App): RoleOutputListener
  /** Bound with the app in hand: the page shows an own agent's call being scored. */
  onFocusCallScored(app: App): CallScoredNotices['onFocusScored']
  /** Where an unaddressed notice goes. A thunk because channels attach and detach while the daemon
   *  runs, and `app` owns the hub that answers - trading never imports a scheduler type. */
  recipient(): DeliveryAddress | undefined
  readonly keys: KeyValidator
  readonly pluginModules: readonly LoadedSourceModule[]
}

/** The options once the sender and the fill listener are built: everything below the provider
 *  reads them themselves. */
type BoundOptions = Omit<
  TradingRegistrationOptions,
  | 'sender'
  | 'onFilled'
  | 'onAlertFired'
  | 'onAlertsChecked'
  | 'onTaskPass'
  | 'runScheduled'
  | 'onRoleOutput'
  | 'onFocusCallScored'
> & {
  readonly sender: TradingNoticeSender
  readonly onFilled: OrderFilledListener
  readonly onAlertFired: AlertFiredListener
  readonly onAlertsChecked: (at: number) => void
  readonly onTaskPass: TaskPassListener
  readonly runScheduled: ScheduledRunner
  readonly onRoleOutput: RoleOutputListener
  readonly onFocusCallScored: CallScoredNotices['onFocusScored']
}

declare module '@/core/container' {
  interface Services {
    tradingStores: TradingStores
    tradingServices: TradingServices
  }
}

interface BuiltTrading {
  readonly services: TradingServices
  readonly contributions: TradingContributions
}

interface Registries {
  readonly markets: MarketRegistry
  readonly sources: SourceRegistry
  readonly stages: StageRegistry
  readonly venues: VenueRegistry
  /** Not a registry, but built here: the markets read rates through the same path the ledger and
   *  the portfolio do, so one outage cannot leave a book converted and a brief unconverted. */
  readonly fx: FxRates
}

/** Provider step 2: the stores need storage and the dialect, and nothing else needs them yet. */
export function createTradingStoresProvider(config: TradingConfig): ServiceProvider {
  return {
    name: 'trading-stores',
    register(bind: Bind): void {
      bind('tradingStores', (app) =>
        createTradingStores({
          db: app.resolve('storage'),
          dialect: app.resolve('dialect'),
          logger: app.resolve('logger'),
          maximumEntries: config.maximumLedgerEntries,
        })
      )
    },
  }
}

/** Provider step 9: after the registries it extends, because `extend` before the matching `bind`
 *  throws, and before plugins so a plugin merges against a registry that already holds every
 *  first-party name. Trading is not a plugin and has no plugin shape. */
export function createTradingRegistrationProvider(
  options: TradingRegistrationOptions
): ServiceProvider {
  // Provider-closure state, never module scope: the tools and commands are built once, validated
  // against both locale catalogs, and then handed to each extend rather than rebuilt per target.
  let built: BuiltTrading | null = null
  const contributions = (app: App): TradingContributions => {
    app.resolve('tradingServices')

    if (built === null) {
      throw new ConfigError('trading contributions were read before registration completed')
    }

    return built.contributions
  }

  return {
    name: 'trading-registration',
    register(bind: Bind, extend: Extend): void {
      bind('tradingServices', (app) => {
        built = buildTrading(app, options)

        return built.services
      })

      bindHostSeams(bind, options)

      extend('tools', (current, app) =>
        mergeUniqueByKey({
          current,
          additions: contributions(app).tools,
          keyOf: (tool) => tool.name,
          label: 'tool name',
        })
      )

      extend('commands', (current, app) => [...current, ...contributions(app).commands])

      extend('cliCommands', (current, app) => [...current, ...contributions(app).cliCommands])

      // Trusted, and registered before plugins: a debate persona is code-owned, so a plugin can
      // never shadow one.
      extend('agents', (current, app) => {
        const trading = buildTradingAgents(app.config, [...app.resolve('tools').keys()])

        return mergeUniqueByKey({
          current,
          additions: trading.values(),
          keyOf: (agent) => agent.id,
          label: 'agent id',
        })
      })

      extend('hooks', (current, app) => mergeHooks(current, app))
    },
  }
}

function buildTrading(app: App, provided: TradingRegistrationOptions): BuiltTrading {
  const options = bindOptions(app, provided)
  const stores = app.resolve('tradingStores')
  const logger = app.resolve('logger')
  const registries = buildRegistries(app, options)
  const budget = (): ReturnType<typeof createConfiguredRunBudget> =>
    createConfiguredRunBudget(app.config)
  const refresh = buildRefreshCoordinator(app, options, registries.markets)
  const services = buildServices(app, options, {
    registries,
    stores,
    refresh,
    logger,
    createSuggestionBudget: budget,
  })
  const refreshMarketData = buildRefreshTick(options, {
    markets: registries.markets,
    stores,
    book: createTradeableBook({ portfolio: services.portfolio, venues: registries.venues }),
    refresh,
    logger,
  })

  const contributions = buildSurfaces(options, {
    services,
    registries,
    stores,
    refreshMarketData,
    logger,
  })

  return {
    services: toAggregate(
      {
        services,
        refresh,
        refreshMarketData,
        macroExtractTick: buildMacroExtractTick(app, registries.sources),
        stores,
        logger,
        defaultLocale: app.config.locale.language,
        createSuggestionBudget: budget,
      },
      options,
      registries
    ),
    contributions,
  }
}

function bindOptions(app: App, provided: TradingRegistrationOptions): BoundOptions {
  return {
    ...provided,
    sender: provided.sender(app),
    onFilled: provided.onFilled(app),
    onAlertFired: provided.onAlertFired(app),
    onAlertsChecked: provided.onAlertsChecked(app),
    onTaskPass: provided.onTaskPass(app),
    runScheduled: provided.runScheduled(app),
    onRoleOutput: provided.onRoleOutput(app),
    onFocusCallScored: provided.onFocusCallScored(app),
  }
}

interface SurfaceParts {
  readonly services: ReturnType<typeof createDomainServices> & WithThemes
  readonly registries: Registries
  readonly stores: TradingStores
  readonly refreshMarketData: TradingServices['refreshMarketData']
  readonly logger: Logger
}

/** The tools and commands, built once and checked before the first surface can render: a
 *  misconfigured install, or a key added to a code tuple without its two catalog entries, fails
 *  during composition rather than at first use. */
function buildSurfaces(options: BoundOptions, parts: SurfaceParts): TradingContributions {
  const { services, registries, stores } = parts
  const contributions = buildContributions({
    services,
    config: options.tradingConfig,
    refreshMarketData: parts.refreshMarketData,
    markets: registries.markets,
    venues: registries.venues,
    intradaySettings: stores.intradaySettings,
    ledger: stores.ledger,
    logger: parts.logger,
  })

  assertRegistryConsistency(registries.markets, options.tradingConfig, {
    keys: options.keys,
    contributions,
    venues: registries.venues,
  })

  return contributions
}

interface ServiceParts {
  readonly registries: Registries
  readonly stores: TradingStores
  readonly refresh: RefreshMarketData
  readonly logger: Logger
  createSuggestionBudget(): ReturnType<typeof createConfiguredRunBudget>
}

function buildServices(
  app: App,
  options: BoundOptions,
  parts: ServiceParts
): ReturnType<typeof createDomainServices> & WithThemes {
  const { logger, registries, stores } = parts
  const domain = createDomainServices({
    ...registries,
    stores,
    refresh: parts.refresh,
    logger,
    sender: options.sender,
    recipient: options.recipient,
    onFilled: options.onFilled,
    onAlertFired: options.onAlertFired,
    onFocusCallScored: options.onFocusCallScored,
    config: options.tradingConfig,
    // Composed here rather than passed in: the debate reads the closed market registry, which does
    // not exist until this function has built it.
    runDebate: createRunDebate({
      runner: { run: (input, runOptions) => app.resolve('runner').run(input, runOptions) },
      logger,
      maximumTurnsPerRole: app.config.loop.maxTurns,
      markets: registries.markets,
      // An absent `decisions` tier turns the headline read off rather than binding a dead chain.
      decisionsChain: app.resolve('llmChains').findTier(DECISIONS_MODEL_TIER),
      recordAttempt: app.resolve('attemptRecorder'),
      onRoleOutput: options.onRoleOutput,
      store: stores.suggestion,
      playbooks: toPlaybookLibrary(TRADING_SKILLS),
    }),
    createSuggestionBudget: () => parts.createSuggestionBudget(),
    defaultLocale: app.config.locale.language,
    skillVersions: skillVersions(),
    personaVersions: personaVersions(),
  })

  return {
    ...domain,
    themes: buildThemeService(app, {
      sources: registries.sources,
      markets: registries.markets,
      marketData: domain.marketData,
      policy: options.tradingConfig.themes,
    }),
  }
}

/** Created and closed once, inside the lazy factory. Nothing above this function ever sees a
 *  registry, mutable or otherwise. */
function buildRegistries(app: App, options: BoundOptions): Registries {
  const logger = app.resolve('logger')
  const stores = app.resolve('tradingStores')
  const sources = withNewsArchive(
    createConfiguredSourceRegistry({
      env: options.env,
      logger,
      pluginModules: options.pluginModules,
      credentialEnv: options.tradingConfig.sourceCredentialEnv,
      defaultVenues: options.tradingConfig.defaultVenues,
      macroReads: stores.marketData,
    }),
    { archive: stores.newsArchive, logger }
  )
  const stages = createStageRegistry()
  const markets = createMarketRegistry()
  const venues = buildVenues(options, logger)
  const fx = createFxRates({ sources, store: stores.fxRate, logger })
  const deps: MarketDeps = {
    config: options.tradingConfig,
    sources,
    fx,
    marketDataStore: stores.marketData,
    macro: macroCache(sources),
    stages,
    venueListings: createVenueListings(venues, logger),
    briefServices: lazyBriefServices(app, options.tradingConfig, venues),
  }

  stages.register(createAdmissionStage())
  stages.register(createExclusionStage())
  stages.register(createDeploymentStage())
  stages.register(createAveragingDownStage())
  stages.register(createRoundTripStage())
  markets.register(createGoldMarket(deps))
  markets.register(createVnGoldMarket(deps))
  markets.register(createVnEquityMarket(deps))
  markets.register(createCryptoMarket(deps))
  markets.close()
  stages.close()
  reportOutdatedHolidayTables(markets, logger, Date.now())

  return { markets, sources, stages, venues, fx }
}

/** The profile reader is the store, not the portfolio service: injecting the service here would
 *  make every LLM request depend on a valuation the modifier never reads. */
function mergeHooks(current: Hooks, app: App): Hooks {
  const trading = createTradingHooks({
    find: (signal) => app.resolve('tradingStores').profile.find(signal),
  })

  return {
    ...current,
    llmRequestModifiers: [...current.llmRequestModifiers, ...trading.llmRequestModifiers],
  }
}
