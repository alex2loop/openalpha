import type { DeliveryHub, KernelDeps } from '@/app/services'
import type { BootExtensionOptions } from '@/app/types'
import type { SessionModelSelection } from '@/commands/api'
import type { App, Bind, ServiceProvider } from '@/core/container'
import type { AgentId } from '@/core/ids'
import type { ToolDefinition } from '@/core/tool'
import type { CliCommandDef } from '@/core/types/cli-command'
import type { Plugin } from '@/core/types/plugin'
import type { AgentProfile, UserAgentSource, Workflow } from '@/engine/api'
import type { OpenedPersistence } from '@/persistence/api'
import type { PluginAssets } from '@/plugins/api'
import type { LoadedSourceModule, UserProfile } from '@/trading/api'
import { createAiProvider } from '@/ai/api'
import { coreCommands } from '@/app/chat-commands'
import { createDaemonTask } from '@/app/daemon'
import { createBootExtensionRegistration } from '@/app/extensions'
import { apiServiceProvider } from '@/app/server/feature'
import {
  buildSchedulerDeps,
  buildToolServices,
  createKernelProvider,
  createMcpSessionLifecycle,
  extendHooks,
  toAgentRegistry,
} from '@/app/services'
import { createReleaseUpdates } from '@/app/update/releases'
import { createHealthSummary, createSpendReader } from '@/app/views'
import { channelsProvider } from '@/channels/api'
import { createCommandsProvider, createSessionModelSelection } from '@/commands/api'
import { OperatorConfigError } from '@/core/config/resolve'
import { agentId } from '@/core/ids'
import {
  addWorkflow,
  buildUserAgents,
  createSkillCatalog,
  engineProvider,
  resolveSkillsDir,
} from '@/engine/api'
import { memoryProvider } from '@/memory/api'
import { createPersistenceProvider } from '@/persistence/api'
import { createPluginsProvider } from '@/plugins/api'
import { createSchedulerProvider } from '@/scheduler/api'
import { toolsProvider } from '@/tools/api'
import { resolveTradingConfig, TRADING_SKILLS, validateAgentFocus } from '@/trading/api'

declare module '@/core/container' {
  interface Services {
    /** Contributed CLI command definitions. The CLI entry adapts and validates them after boot;
     *  built-ins never pass through here (`cli/registry.ts` stays static so preflight stays
     *  pre-boot). */
    cliCommands: readonly CliCommandDef[]
    /** The ids of the operator's own agents, which the built-ins and plugin agents are not: the only
     *  ones that can be paused or join a social network. */
    userAgentIds: ReadonlySet<AgentId>
  }
}

// spec §14 — the canonical order. Every `extend` target must already exist via an earlier `bind`,
// so this list is load-bearing: never reorder it without walking the 9 constraints below.
//
//  0a. logger          (core, inline)
//  0b. bus             (core, inline)
//  0c. sessionQueue    (core, inline)
//  1.  storage          (persistence)
//  2.  tradingStores    (trading)        <- interchangeable with 3
//  2b. baseCurrencyGuard (app, inline: extends tradingStores.profile/ledger — must follow 2)
//  3.  memory           (memory)         <- interchangeable with 2
//  4.  ai               (ai)
//  5.  engine           (engine: bases + machinery + budget)
//  6.  tools            (tools: binds the BUILT_IN_TOOLS registry)
//  7.  channels         (channels: base) <- interchangeable with 8
//  8.  commands         (commands: base) <- interchangeable with 7
//  8b. cliCommands      (app, inline: contributed CLI defs base)
//  8c. social           (app: binds socialService; extends tools and commands)
//  9.  registerTrading  (trading: extends tools, commands, agents, and hooks)
//  10. plugins          (plugins: extends the registries after trading)
//  11. mcp              (engine: extends tools, last)
//  12. userAgents       (engine: extends agents, add-only)
//  13. app              (cross-module bindings)
//  13b. scheduler       (scheduler: job commands + daemon task)
//  14. bootExtensions   (after app, before feature providers)
//
// The 9 hard constraints (spec §14):
//
//  1. logger/bus/sessionQueue before all.
//  2. storage before 2/3/5(costTracker).
//  3. ai before 5 (compactor).
//  4. engine before 6/10 (bases + tools base).
//  5. tools before 10/11 (plugins + mcp extend tools).
//  6. commands before 10 (plugins extends it). Channels binds and extends itself.
//  7. registerTrading before plugins (trading contributions are part of each base registry).
//  8. plugins before 11/12 (mcp + userAgents layer on).
//  9. cliCommands before 9/10 (trading + plugins extend it).
//
// `extend` before the matching `bind` throws in `createApp`, which enforces 5, 6, 9 and the plugins
// half of 4. The rest are convention: 1-3 and the tools half of 4 are lazy binds, and 7-8 order two
// extenders of one already-bound key, where a duplicate makes the loser throw either way.
//
// Step 1 maps to the persistence provider. Trading owns the stores at step 2 and contributes its
// runtime services and registries at step 9.
// `BootOptions.features` providers register after this canonical order, so a feature's extends see
// the fully-assembled table.

/** Everything the container needs that only async work can produce. Loaded once, by boot. */
export interface RuntimeAssets {
  readonly kernel: KernelDeps
  readonly delivery: DeliveryHub
  /** Discovered on disk; merged in at step 10. */
  readonly plugins: readonly Plugin[]
  /** Plugin TOML loaded by boot; registry factories never read contribution paths. */
  readonly pluginAssets: PluginAssets
  /** Plugin `sources.ts` modules imported at boot; consumed by the trading registration. */
  readonly pluginSourceModules: readonly LoadedSourceModule[]
  /** The connected MCP servers' tools; layered onto the registry at step 11. */
  readonly mcpTools: readonly ToolDefinition[]
  /** Raw `<dataDir>/agents/<id>/agent.toml`, built into profiles at step 12. */
  readonly userAgents: readonly UserAgentSource[]
  /** Parsed `<dataDir>/workflows/*.toml`, layered after built-in and plugin workflows. */
  readonly userWorkflows: readonly Workflow[]
}

interface ProviderAssembly {
  readonly providers: readonly ServiceProvider[]
  assertExtensionsRegistered(app: App): void
}

interface BuildProvidersOptions {
  readonly assets: RuntimeAssets
  readonly persistence: OpenedPersistence
  readonly extensions: BootExtensionOptions
  /** Steps 2 and 9. Boot builds both: every input is boot-owned and unread here. */
  readonly tradingStores: ServiceProvider
  readonly tradingRegistration: ServiceProvider
  /** Step 8c. Boot builds it from the resolved `[social]`. */
  readonly social: ServiceProvider
  /** Step 4. The boot environment, where the cloud sign-ins find their credentials. */
  readonly env: Readonly<Record<string, string | undefined>>
}

export function buildProviders(options: BuildProvidersOptions): ProviderAssembly {
  const bootExtension = createBootExtensionRegistration(options.extensions)
  const providers: readonly ServiceProvider[] = [
    createKernelProvider(options.assets.kernel), // 0a-0c
    createPersistenceProvider(options.persistence), // 1
    options.tradingStores, // 2
    createBaseCurrencyGuardProvider(), // 2b
    memoryProvider, // 3
    createAiProvider(options.env), // 4
    engineProvider, // 5
    toolsProvider, // 6
    channelsProvider, // 7
    createCommandsProvider(coreCommands, options.extensions.keys), // 8
    createCliCommandsProvider(), // 8b
    options.social, // 8c
    options.tradingRegistration, // 9
    createPluginsProvider([], options.assets.plugins, options.assets.pluginAssets), // 10
    createMcpProvider(options.assets.mcpTools), // 11
    createUserAgentsProvider(options.assets.userAgents), // 12
    createAppProvider(
      options.assets.delivery,
      options.assets.userWorkflows,
      options.assets.plugins
    ), // 13
    createSchedulerProvider((app) => buildSchedulerDeps(app, options.assets.delivery)), // 13b
    bootExtension.provider, // 14 — after the app provider, before features
    apiServiceProvider, // 15 — the HTTP/WS API; the daemon starts it only with [api] enabled
  ]

  return { providers, assertExtensionsRegistered: bootExtension.assertRegistered }
}

// Step 2b: the persisted profile fixes the book's base currency the first time it is saved
// (portfolio/profile.ts) while `[locale] currency` is live config a later edit can change.
// Unguarded, a mismatch only surfaces as a repeated ValidationError deep inside the ledger fold
// (portfolio/book.ts assertRecordedInBase) on every portfolio read thereafter. Wrapping the two
// store methods that feed the fold — `profile.find` and `ledger.listAll` — turns every one of
// those reads into a single clear config error instead.
function createBaseCurrencyGuardProvider(): ServiceProvider {
  return {
    name: 'trading-base-currency-guard',
    register(_bind, extend): void {
      extend('tradingStores', (current, app) => {
        const baseCurrency = resolveTradingConfig({
          extensions: app.config.extensions,
          locale: app.config.locale,
        }).baseCurrency
        const findProfile = (signal: AbortSignal): Promise<UserProfile | null> =>
          assertProfileCurrency(current.profile.find(signal), baseCurrency)

        return {
          ...current,
          profile: { ...current.profile, find: findProfile },
          ledger: {
            ...current.ledger,
            listAll: async (signal) => {
              await findProfile(signal)
              return current.ledger.listAll(signal)
            },
          },
        }
      })
    },
  }
}

async function assertProfileCurrency(
  pending: Promise<UserProfile | null>,
  baseCurrency: UserProfile['baseCurrency']
): Promise<UserProfile | null> {
  const profile = await pending

  if (profile && profile.baseCurrency !== baseCurrency) {
    throw new OperatorConfigError(
      `[locale] currency is ${baseCurrency}, but the trading profile was created with ` +
        `${profile.baseCurrency} and never changes; restore [locale] currency to ` +
        `${profile.baseCurrency}`,
      {
        key: 'errors.configCurrencyLocked',
        params: { currency: baseCurrency, profileCurrency: profile.baseCurrency },
      },
      { path: ['locale', 'currency'] }
    )
  }

  return profile
}

// Step 8b: the empty base the trading and plugins providers extend. App owns it because no domain
// module may know the CLI exists, and the CLI cannot register providers.
function createCliCommandsProvider(): ServiceProvider {
  return {
    name: 'cli-commands',
    register(bind): void {
      bind('cliCommands', () => [])
    },
  }
}

// Step 11: MCP tools land last, so they see the plugin-merged registry and not just the built-ins.
// A name already in the registry is NOT overwritten: an external server does not get to redefine a
// built-in tool by claiming its name.
function createMcpProvider(tools: readonly ToolDefinition[]): ServiceProvider {
  return {
    name: 'mcp',
    register(_bind, extend): void {
      extend('tools', (current) => {
        const merged = new Map(current)

        for (const tool of tools) {
          if (!merged.has(tool.name)) {
            merged.set(tool.name, tool)
          }
        }

        return merged
      })
    },
  }
}

// Step 12: add-only. A user agent whose id collides with a built-in or a plugin's is skipped rather
// than allowed to shadow it (buildUserAgents logs each skip).
function createUserAgentsProvider(sources: readonly UserAgentSource[]): ServiceProvider {
  // Captured from the one build below and never rebuilt: `userAgentIds` reads what `agents` kept.
  let userIds: ReadonlySet<AgentId> = new Set()

  return {
    name: 'user-agents',
    register(bind, extend): void {
      bind('userAgentIds', (app) => {
        app.resolve('agents')

        return userIds
      })
      extend('agents', (current, app) => {
        const added = buildUserAgents(sources, {
          ctx: {
            config: app.config,
            allToolNames: [...app.resolve('tools').keys()],
            trusted: false,
          },
          reserved: new Set(current.keys()),
          logger: app.resolve('logger'),
        })
        const kept = withoutInvalidTables(
          new Map<string, AgentProfile>([...current, ...added]),
          app
        )

        userIds = new Set([...added.keys()].filter((id) => kept.has(id)).map(agentId))

        return kept
      })
    },
  }
}

// `[focus]` is a raw table to the engine; trading owns what it means, so an agent whose table it
// rejects is skipped here rather than failing a run later. Resolving `tradingServices` is
// cycle-free: `extend('agents')` already resolves `tools`, which resolves it.
function withoutInvalidTables(
  agents: ReadonlyMap<string, AgentProfile>,
  app: App
): Map<string, AgentProfile> {
  const logger = app.resolve('logger')
  const scope = app.resolve('tradingServices').focusScope
  const kept = new Map<string, AgentProfile>()

  for (const [id, agent] of agents) {
    const issues = agent.focus === undefined ? [] : validateAgentFocus(agent.focus, scope)

    if (issues.length > 0) {
      logger.warn('agents.focus_invalid', { id, issues })
      continue
    }

    kept.set(id, agent)
  }

  return kept
}

// What a run reads before it starts, bound here because only the composition root can see both the
// engine and the stores: the session's prior transcript and totals, and an agent's spend today.
function bindRunReads(bind: Bind): void {
  bind(
    'sessionHistory',
    (app) => (sessionId, limit) => app.resolve('sessionStore').loadHistory(sessionId, limit)
  )
  bind('priorTotals', (app) => (sessionId) => app.resolve('sessionStore').loadTotals(sessionId))
  bind(
    'agentSpentToday',
    (app) => (id, nowMs) => app.resolve('llmAttemptStore').totalForBillingAgent(id, nowMs)
  )
}

// The bindings that exist only because the composition root can see every module at once: the tool
// handles, the persistence/memory/skills hooks, the session trail, and the scheduler's deps.
function createAppProvider(
  delivery: DeliveryHub,
  userWorkflows: readonly Workflow[],
  plugins: readonly Plugin[]
): ServiceProvider {
  let modelSelection: SessionModelSelection | null = null

  return {
    name: 'app',
    register(bind, extend): void {
      bind('skillCatalog', (app) =>
        createSkillCatalog({
          embedded: Object.values(TRADING_SKILLS),
          directories: skillDirectories(app, plugins),
        })
      )
      bind('modelControl', (app) => resolveModelSelection(app).control)
      bind('agentForRun', (app) => resolveModelSelection(app).agentForRun)
      bind('healthSummary', (app) => createHealthSummary(app, delivery))
      bind('releaseUpdates', createReleaseUpdates)
      bind('spendReader', (app) => createSpendReader(app))
      bind('toolServices', buildToolServices)
      bind('mcpSessionLifecycle', createMcpSessionLifecycle)
      bind('daemonTask', (app) => createDaemonTask(app, delivery))
      bind('noticeSurfaces', () => delivery.surfaces)
      bindRunReads(bind)

      // The one sink-to-store binding: every durable provider attempt flows through here.
      bind('llmAttemptSink', (app) => ({
        record: (attempt) => app.resolve('llmAttemptStore').record(attempt),
      }))

      extend('hooks', extendHooks)
      extend('workflows', (current) => {
        const merged = new Map(current)

        for (const workflow of userWorkflows) {
          addWorkflow(merged, workflow)
        }

        return merged
      })
    },
  }

  function resolveModelSelection(app: App): SessionModelSelection {
    if (modelSelection !== null) {
      return modelSelection
    }

    const selectableModels = app.config.models.map((entry) => ({
      selector: entry.selector,
      providerModel: { provider: entry.provider, model: entry.model },
    }))

    modelSelection = createSessionModelSelection(
      toAgentRegistry(app.resolve('agents')),
      selectableModels
    )
    return modelSelection
  }
}

function skillDirectories(app: App, plugins: readonly Plugin[]): readonly string[] {
  return [
    ...new Set([
      resolveSkillsDir(app.config.paths.dataDir),
      ...app.config.paths.skillsDirs,
      ...plugins.flatMap((plugin) => plugin.contributions.skillsDirs ?? []),
    ]),
  ]
}
