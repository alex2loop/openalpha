import type { App, Bind, Extend, ServiceProvider, TaskPassListener } from '@/core/container'
import type { RequestShape } from '@/core/http-client'
import type { ReachabilityProbe } from '@/core/limits'
import type { Logger } from '@/core/logging/logger'
import type { ScheduledRunner } from '@/core/types/command'
import type { Hooks } from '@/engine/api'
import type {
  PublicBriefCredential,
  PublicBriefPublisher,
} from '@/trading/features/brief/public/types'
import type { RefreshMarketData } from '@/trading/features/market-data/ops/refresh'
import type { DebateDeps } from '@/trading/features/suggestion/debate/call'
import type { RoleOutputListener } from '@/trading/features/suggestion/debate/types'
import type { CallScoredNotices } from '@/trading/features/suggestion/track-record/scored-notice'
import type { TradingConfig } from '@/trading/kernel/config'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type {
  AlertFiredListener,
  OrderFilledListener,
  TradingNoticeSender,
} from '@/trading/kernel/operator/notice'
import type { LoadedSourceModule } from '@/trading/sources/plugin-module'
import type { SourceRouteTable } from '@/trading/sources/routes'
import type { HostSourceFacts } from '@/trading/sources/types'
import type { TradingEdition } from '@/trading/wiring/composition/edition'
import type { Registries } from '@/trading/wiring/composition/registries'
import type {
  KeyValidator,
  TradingContributions,
} from '@/trading/wiring/composition/registry-checks'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import type { TradingStores } from '@/trading/wiring/composition/stores'
import type { WithThemes } from '@/trading/wiring/composition/themes'
import { ConfigError } from '@/core/errors'
import { registerKnownSecret, resolveCredential } from '@/core/security/credentials'
import { createConfiguredRunBudget } from '@/engine/api'
import { createEnsureMarketData } from '@/trading/features/market-data/ops/ensure'
import { createRunDebate } from '@/trading/features/suggestion/debate/debate'
import { toPlaybookLibrary } from '@/trading/features/suggestion/debate/playbook'
import { DECISIONS_MODEL_TIER, PUBLIC_BRIEF_TOKEN_VARIABLE } from '@/trading/kernel/config'
import { buildTradingAgents, personaVersions } from '@/trading/wiring/catalog/agents'
import { skillVersions, TRADING_SKILLS } from '@/trading/wiring/catalog/skills'
import { toAggregate } from '@/trading/wiring/composition/aggregate'
import { buildContributions, mergeUniqueByKey } from '@/trading/wiring/composition/contributions'
import { bindHostSeams } from '@/trading/wiring/composition/host-seams'
import { buildMarketTicks } from '@/trading/wiring/composition/market-ticks'
import { buildRefreshCoordinator, resolveMarketsInUse } from '@/trading/wiring/composition/refresh'
import { buildRegistries } from '@/trading/wiring/composition/registries'
import { assertRegistryConsistency } from '@/trading/wiring/composition/registry-checks'
import { createDomainServices } from '@/trading/wiring/composition/services'
import { buildThemeService } from '@/trading/wiring/composition/themes'
import { createTradingHooks } from '@/trading/wiring/profile-context'

/** Only what the container cannot supply. Everything else — the logger, the runner, the locale,
 *  the budget policy — is resolved from `App` inside the lazy factory, so nothing here duplicates
 *  a value the container already owns. */
interface TradingRegistrationOptions
  extends Pick<Parameters<typeof buildMarketTicks>[1]['host'], 'processMemory'> {
  readonly tradingConfig: TradingConfig
  /** Injected, never read from `process`: source credentials resolve from named variables the
   *  code owns, so the value reaches the transport without passing through a config object. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Built where it binds, with the app in hand: the sender reads services the container
   *  supplies. */
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
  /** How every source request presents itself: the daemon's or a page's. */
  readonly requestShape: RequestShape
  readonly routes?: SourceRouteTable
  /** What this host states of how its source requests present; absent is the daemon's. A page
   *  cannot set a user agent, reads only the feeds a browser can, and waits longer on a slow
   *  edge. */
  readonly sourceFacts?: HostSourceFacts
  /** What this edition narrows, bound with the app in hand like the sender; absent is the
   *  installed version. */
  edition?(app: App): TradingEdition
  /** How the loops tell the network is up: the daemon resolves a name. */
  readonly reachability: ReachabilityProbe
  /** Posts the public brief; absent on a host that never publishes. Built with the credential, so
   *  the token reaches it and nothing else. */
  createPublicBriefPublisher?(
    credential: PublicBriefCredential,
    logger: Logger
  ): PublicBriefPublisher
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
  | 'edition'
> & {
  readonly sender: TradingNoticeSender
  readonly onFilled: OrderFilledListener
  readonly onAlertFired: AlertFiredListener
  readonly onAlertsChecked: (at: number) => void
  readonly onTaskPass: TaskPassListener
  readonly runScheduled: ScheduledRunner
  readonly onRoleOutput: RoleOutputListener
  readonly onFocusCallScored: CallScoredNotices['onFocusScored']
  readonly edition?: TradingEdition
  readonly lateGraceMs: number
  readonly publicBriefPublisher?: PublicBriefPublisher
}

function bindOptions(app: App, provided: TradingRegistrationOptions): BoundOptions {
  const { edition, ...rest } = provided
  const logger = app.resolve('logger')
  const publicBriefPublisher = publisherOf(
    provided,
    resolvePublicBriefToken(provided, logger),
    logger
  )

  return {
    ...rest,
    sender: provided.sender(app),
    onFilled: provided.onFilled(app),
    onAlertFired: provided.onAlertFired(app),
    onAlertsChecked: provided.onAlertsChecked(app),
    onTaskPass: provided.onTaskPass(app),
    runScheduled: provided.runScheduled(app),
    onRoleOutput: provided.onRoleOutput(app),
    onFocusCallScored: provided.onFocusCallScored(app),
    ...(edition === undefined ? {} : { edition: edition(app) }),
    lateGraceMs: app.config.schedule.lateGraceMs,
    ...(publicBriefPublisher === undefined ? {} : { publicBriefPublisher }),
  }
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
  const coordinator = buildRefreshCoordinator(app, options, registries.markets)
  const services = buildServices(app, options, {
    registries,
    stores,
    ...coordinator,
    logger,
    createSuggestionBudget: budget,
  })
  const ticks = buildMarketTicks(app, {
    registries,
    stores,
    services,
    refresh: coordinator.refresh,
    host: options,
    logger,
  })

  const contributions = buildSurfaces(options, {
    services,
    registries,
    stores,
    ticks,
    logger,
  })

  return {
    services: toAggregate(
      {
        services,
        refresh: coordinator.refresh,
        ...ticks,
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

/** Read once, here: the value reaches the scrubber and the credential below, so it cannot land in a
 *  log, an error or the config. Setting it without turning the feature on is harmless; turning the
 *  feature on without it leaves the publisher idle, which the start says once. */
function resolvePublicBriefToken(
  options: TradingRegistrationOptions,
  logger: Logger
): PublicBriefCredential | undefined {
  const token = resolveCredential(options.env, PUBLIC_BRIEF_TOKEN_VARIABLE)

  if (token !== undefined) {
    registerKnownSecret(token)

    return { token }
  }

  if (options.tradingConfig.publicBrief.enabled) {
    logger.warn('trading.public_brief_token_missing', { variable: PUBLIC_BRIEF_TOKEN_VARIABLE })
  }

  return undefined
}

/** The publisher exists only when the feature is on, a token is set and the host binds one. */
function publisherOf(
  options: TradingRegistrationOptions,
  credential: PublicBriefCredential | undefined,
  logger: Logger
): PublicBriefPublisher | undefined {
  return options.tradingConfig.publicBrief.enabled && credential !== undefined
    ? options.createPublicBriefPublisher?.(credential, logger)
    : undefined
}

interface SurfaceParts {
  readonly services: ReturnType<typeof createDomainServices> & WithThemes
  readonly registries: Registries
  readonly stores: TradingStores
  readonly ticks: Pick<ReturnType<typeof buildMarketTicks>, 'refreshMarketData' | 'inUse'>
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
    refreshMarketData: parts.ticks.refreshMarketData,
    marketsInUse: (signal) => resolveMarketsInUse(parts.ticks.inUse, signal),
    markets: registries.markets,
    venues: registries.venues,
    intradaySettings: stores.intradaySettings,
    ledger: stores.ledger,
    logger: parts.logger,
    ...(options.edition === undefined ? {} : { edition: options.edition }),
  })

  assertRegistryConsistency(registries.markets, options.tradingConfig, {
    edition: options.edition,
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
  readonly firstLoading: ReadonlySet<MarketRef>
  readonly firstLoadFailed: ReadonlySet<MarketRef>
  readonly logger: Logger
  createSuggestionBudget(): ReturnType<typeof createConfiguredRunBudget>
}

function buildServices(
  app: App,
  options: BoundOptions,
  parts: ServiceParts
): ReturnType<typeof createDomainServices> & WithThemes {
  const { logger, registries, stores } = parts
  const debate = buildDebateDeps(app, options, parts)
  const domain = createDomainServices({
    ...registries,
    stores,
    ensure: createEnsureMarketData({
      markets: registries.markets,
      marketDataStore: stores.marketData,
      refresh: parts.refresh,
      firstLoading: parts.firstLoading,
      firstLoadFailed: parts.firstLoadFailed,
      signal: app.signal,
      logger,
    }),
    logger,
    sender: options.sender,
    recipient: options.recipient,
    onFilled: options.onFilled,
    onAlertFired: options.onAlertFired,
    onFocusCallScored: options.onFocusCallScored,
    config: options.tradingConfig,
    // Composed here rather than passed in: the debate reads the closed market registry, which does
    // not exist until this function has built it.
    runDebate: createRunDebate(debate),
    debate,
    createSuggestionBudget: () => parts.createSuggestionBudget(),
    defaultLocale: app.config.locale.language,
    skillVersions: skillVersions(),
    personaVersions: personaVersions(),
    ...(options.edition === undefined ? {} : { edition: options.edition }),
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

/** What the role runner and the analysis share: one set of deps, so the full debate and the
 *  analysis read the same persona calls. */
function buildDebateDeps(app: App, options: BoundOptions, parts: ServiceParts): DebateDeps {
  const { logger, registries, stores } = parts

  return {
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
  }
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
