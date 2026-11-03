import type { App, Bind, Extend, ServiceProvider } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { Hooks } from '@/engine/api'
import type { RefreshMarketData } from '@/trading/features/market-data/ops/refresh'
import type { DebateDeps } from '@/trading/features/suggestion/debate/call'
import type {
  BoundOptions,
  TradingRegistrationOptions,
} from '@/trading/wiring/composition/registration-options'
import type { Registries } from '@/trading/wiring/composition/registries'
import type { TradingContributions } from '@/trading/wiring/composition/registry-checks'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import type { TradingStores } from '@/trading/wiring/composition/stores'
import type { WithThemes } from '@/trading/wiring/composition/themes'
import { ConfigError } from '@/core/errors'
import { createConfiguredRunBudget } from '@/engine/api'
import { createRunDebate } from '@/trading/features/suggestion/debate/debate'
import { toPlaybookLibrary } from '@/trading/features/suggestion/debate/playbook'
import { DECISIONS_MODEL_TIER } from '@/trading/kernel/config'
import { buildTradingAgents, personaVersions } from '@/trading/wiring/catalog/agents'
import { skillVersions, TRADING_SKILLS } from '@/trading/wiring/catalog/skills'
import { toAggregate } from '@/trading/wiring/composition/aggregate'
import { buildContributions, mergeUniqueByKey } from '@/trading/wiring/composition/contributions'
import { bindHostSeams } from '@/trading/wiring/composition/host-seams'
import { buildMarketTicks } from '@/trading/wiring/composition/market-ticks'
import { buildRefreshCoordinator, resolveMarketsInUse } from '@/trading/wiring/composition/refresh'
import { bindOptions } from '@/trading/wiring/composition/registration-options'
import { buildRegistries } from '@/trading/wiring/composition/registries'
import { assertRegistryConsistency } from '@/trading/wiring/composition/registry-checks'
import { createDomainServices } from '@/trading/wiring/composition/services'
import { buildThemeService } from '@/trading/wiring/composition/themes'
import { createTradingHooks } from '@/trading/wiring/profile-context'

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
  const refresh = buildRefreshCoordinator(app, options, registries.markets)
  const services = buildServices(app, options, {
    registries,
    stores,
    refresh,
    logger,
    createSuggestionBudget: budget,
  })
  const ticks = buildMarketTicks(app, {
    registries,
    stores,
    services,
    refresh,
    scheduled: options,
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
        refresh,
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
  const debate = buildDebateDeps(app, options, parts)
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
    runDebate: createRunDebate(debate),
    debate,
    createSuggestionBudget: () => parts.createSuggestionBudget(),
    defaultLocale: app.config.locale.language,
    skillVersions: skillVersions(),
    personaVersions: personaVersions(),
    ...(options.edition?.reads === undefined ? {} : { reads: options.edition.reads }),
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

/** What the role runner and the analysis share: one set of deps, so the full debate and the analysis
 *  read the same persona calls. */
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
