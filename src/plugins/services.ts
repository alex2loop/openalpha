import type { ResolvedConfig } from '@/core/config/resolve'
import type { App, ServiceProvider } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { ToolDefinition } from '@/core/tool'
import type { SlashCommand } from '@/core/types/command'
import type {
  AgentProfileSource,
  ChannelDefinitionRef,
  DeclarativeChannelSource,
  Plugin,
} from '@/core/types/plugin'
import type { AgentBuildContext, AgentProfile, Workflow } from '@/engine/api'
import { ConfigError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { canRequireApproval, loadAgentFromText } from '@/engine/api'
import { createDeclarativeCommand } from '@/plugins/contributions/command'
import { mergeExternalMcpTools } from '@/plugins/contributions/external-tools'
import {
  mergeChannelDefinitions,
  mergeCliCommands,
  mergeDeclarativeChannels,
  mergeSlashCommands,
  mergeTools,
} from '@/plugins/contributions/merge'
import { discoverInstalledPlugins } from '@/plugins/lifecycle/discover'
import { assertBundledPlugins } from '@/plugins/policy/trust'

const EMPTY_PLUGIN_ASSETS: PluginAssets = {
  agentTomls: new Map(),
  externalMcpTools: new Map(),
  workflows: new Map(),
}

declare module '@/core/container' {
  interface Services {
    plugins: readonly Plugin[]
    pluginChannelDefinitions: readonly ChannelDefinitionRef[]
    pluginChannelSources: readonly DeclarativeChannelSource[]
    /** Ids the composition shipped with, never user-installed — uninstall must refuse these. */
    bundledPluginIds: ReadonlySet<string>
  }
}

/** Plugin file contents parsed at boot so registry factories remain synchronous and I/O-free. */
export interface PluginAssets {
  readonly agentTomls: ReadonlyMap<string, string>
  readonly externalMcpTools: ReadonlyMap<string, ToolDefinition>
  readonly workflows: ReadonlyMap<string, Workflow>
}

interface PluginAgentRegistryOptions {
  readonly current: ReadonlyMap<string, AgentProfile>
  readonly app: App
  readonly assets: PluginAssets
  readonly bundled: ReadonlySet<Plugin>
}

interface PluginAgentMergeDeps {
  readonly assets: PluginAssets
  readonly bundled: ReadonlySet<Plugin>
  readonly ctx: Omit<AgentBuildContext, 'trusted'>
  /** The tool universe an untrusted profile may draw on — both its default and its allowlist. */
  readonly safeToolNames: readonly string[]
  readonly logger: Logger
}

interface PluginAgentEntry extends PluginAgentMergeDeps {
  readonly next: Map<string, AgentProfile>
  readonly plugin: Plugin
  readonly source: AgentProfileSource
}

interface PluginWorkflowMergeOptions {
  readonly current: ReadonlyMap<string, Workflow>
  readonly plugins: readonly Plugin[]
  readonly assets: PluginAssets
  readonly bundled: ReadonlySet<Plugin>
  readonly logger: Logger
}

interface PluginWorkflowMergeDeps {
  readonly assets: PluginAssets
  readonly trusted: boolean
  readonly logger: Logger
}

export function createPluginsProvider(
  bundled: readonly Plugin[],
  installed: readonly Plugin[] = [],
  assets: PluginAssets = EMPTY_PLUGIN_ASSETS
): ServiceProvider {
  assertBundledPlugins(bundled)

  const trustedBundled = new Set(bundled)
  const registeredPlugins = [...bundled, ...excludeBundledIdCollisions(bundled, installed)]

  return {
    name: 'plugins',
    register(bind, extend): void {
      bind('plugins', () => registeredPlugins)
      bind('bundledPluginIds', () => new Set(bundled.map((plugin) => plugin.id)))
      bind('pluginChannelDefinitions', (app) =>
        mergeChannelDefinitions([], app.resolve('plugins'), trustedBundled)
      )
      bind('pluginChannelSources', (app) =>
        mergeDeclarativeChannels([], app.resolve('plugins'), app.resolve('logger'))
      )

      extend('tools', (current, app) => {
        const plugins = app.resolve('plugins')
        const merged = mergeTools([...current.values()], plugins, trustedBundled)

        return mergeExternalMcpTools({
          current: new Map(merged.map((tool) => [tool.name, tool])),
          plugins,
          bundled: trustedBundled,
          loaded: assets.externalMcpTools,
        })
      })

      extend('agents', (current, app) =>
        mergePluginAgents({ current, app, assets, bundled: trustedBundled })
      )

      extend('workflows', (current, app) =>
        mergePluginWorkflows({
          current,
          plugins: app.resolve('plugins'),
          assets,
          bundled: trustedBundled,
          logger: app.resolve('logger'),
        })
      )

      extend('commands', (current, app) => {
        const plugins = app.resolve('plugins')
        const merged = mergeSlashCommands(current, plugins, trustedBundled)

        return mergeDeclarativeCommands(merged, plugins, app)
      })

      extend('cliCommands', (current, app) =>
        mergeCliCommands(current, app.resolve('plugins'), trustedBundled)
      )
    },
  }
}

export async function loadInstalledPlugins(
  config: ResolvedConfig,
  logger: Logger
): Promise<readonly Plugin[]> {
  if (!config.plugins.allowUntrusted) {
    return []
  }

  const found = await Promise.all(
    config.plugins.dirs.map((dir) => discoverInstalledPlugins(dir, logger))
  )

  return config.plugins.allowCode ? found.flat() : found.flat().map(withoutSourceModules)
}

function withoutSourceModules(plugin: Plugin): Plugin {
  const { sourceModules: _dropped, ...rest } = plugin.contributions

  return { id: plugin.id, contributions: rest }
}

function excludeBundledIdCollisions(
  bundled: readonly Plugin[],
  installed: readonly Plugin[]
): readonly Plugin[] {
  const bundledIds = new Set(bundled.map((plugin) => plugin.id))

  return installed.filter((plugin) => !bundledIds.has(plugin.id))
}

function mergePluginAgents(options: PluginAgentRegistryOptions): ReadonlyMap<string, AgentProfile> {
  const { current, app, assets, bundled } = options
  const tools = [...app.resolve('tools').values()]
  const ctx = { config: app.config, allToolNames: tools.map((tool) => tool.name) }
  const safeToolNames = tools.filter((tool) => !canRequireApproval(tool)).map((tool) => tool.name)
  const deps = { assets, bundled, ctx, safeToolNames, logger: app.resolve('logger') }
  const next = new Map(current)

  for (const plugin of app.resolve('plugins')) {
    appendPluginAgents(next, plugin, deps)
  }

  return next
}

function appendPluginAgents(
  next: Map<string, AgentProfile>,
  plugin: Plugin,
  deps: PluginAgentMergeDeps
): void {
  for (const source of plugin.contributions.agents ?? []) {
    appendPluginAgent({ next, plugin, source, ...deps })
  }
}

function appendPluginAgent(entry: PluginAgentEntry): void {
  const { next, plugin, source, assets, bundled, ctx, safeToolNames, logger } = entry
  const trusted = bundled.has(plugin)

  if (trusted && next.has(source.id)) {
    throw new ConfigError(`duplicate agent id: ${source.id}`)
  }

  if (!trusted && next.has(source.id)) {
    logger.warn('plugin.agent_collision', { plugin: plugin.id, agent: source.id })
    return
  }

  const text = assets.agentTomls.get(source.tomlPath)

  if (text === undefined) {
    return
  }

  try {
    const allToolNames = trusted ? ctx.allToolNames : safeToolNames

    next.set(source.id, loadAgentFromText(text, source.id, { ...ctx, allToolNames, trusted }))
  } catch (err: unknown) {
    logger.warn('plugin.agent_skipped', {
      plugin: plugin.id,
      agent: source.id,
      err: formatErrForLog(err),
    })
  }
}

function mergeDeclarativeCommands(
  current: readonly SlashCommand[],
  plugins: readonly Plugin[],
  app: App
): readonly SlashCommand[] {
  const next = new Map(current.map((command) => [command.name, command]))
  const deps = {
    agents: app.resolve('agents'),
    workflows: app.resolve('workflows'),
    runner: app.resolve('runner'),
    config: app.config,
    logger: app.resolve('logger'),
  }

  for (const plugin of plugins) {
    for (const source of plugin.contributions.declarativeSlashCommands ?? []) {
      if (next.has(source.name)) {
        deps.logger.warn('plugins.command_name_taken', { plugin: plugin.id, command: source.name })

        continue
      }

      next.set(source.name, createDeclarativeCommand(source, deps))
    }
  }

  return [...next.values()]
}

function mergePluginWorkflows(options: PluginWorkflowMergeOptions): ReadonlyMap<string, Workflow> {
  const { current, plugins, assets, bundled, logger } = options
  const next = new Map(current)

  for (const plugin of plugins) {
    appendPluginWorkflows(next, plugin, { assets, trusted: bundled.has(plugin), logger })
  }

  return next
}

function appendPluginWorkflows(
  next: Map<string, Workflow>,
  plugin: Plugin,
  deps: PluginWorkflowMergeDeps
): void {
  const { assets, trusted, logger } = deps

  for (const source of plugin.contributions.workflows ?? []) {
    const workflow = assets.workflows.get(source.definitionPath)

    if (workflow === undefined) {
      continue
    }

    // A schedule runs the workflow's agents on a cron with no human in the loop; contributing one
    // is an escalation beyond the declarative dispatch an untrusted plugin is allowed.
    if (!trusted && workflow.schedule !== undefined) {
      logger.warn('plugin.workflow_skipped', {
        plugin: plugin.id,
        workflow: workflow.id,
        reason: 'untrusted_schedule',
      })

      continue
    }

    if (next.has(workflow.id)) {
      logger.warn('plugin.workflow_skipped', {
        plugin: plugin.id,
        workflow: workflow.id,
        reason: 'id_collision',
      })

      continue
    }

    next.set(workflow.id, workflow)
  }
}
