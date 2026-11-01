import { join } from 'node:path'

import type { DeliveryHub } from '@/app/delivery'
import type { RuntimeAssets } from '@/app/providers'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'
import type { ToolDefinition } from '@/core/tool'
import type { AgentProfileSource, McpToolSource, Plugin, WorkflowSource } from '@/core/types/plugin'
import type { UserAgentSource } from '@/engine/api'
import { connectMcpServers } from '@/app/mcp-connections'
import { createCommandLane } from '@/core/command-lane'
import { ConfigError } from '@/core/errors'
import { createEventBus } from '@/core/events'
import { formatErrForLog } from '@/core/security/credentials'
import { createSessionQueue } from '@/core/session-queue'
import {
  assertAgentTomlMatchesSourceId,
  loadUserWorkflows,
  loadWorkflowToml,
  readUserAgents,
  userAgentsDir,
} from '@/engine/api'
import {
  loadInstalledPlugins,
  mcpToolName,
  mcpToolSourceKey,
  type PluginAssets,
} from '@/plugins/api'
import { loadPluginSourceModules } from '@/trading/api'

const WORKFLOWS_DIR = 'workflows'

interface AssetLoadOptions {
  readonly config: ResolvedConfig
  readonly logger: Logger
  readonly delivery: DeliveryHub
  readonly childEnvBase: Readonly<Record<string, string>>
  readonly bootScope: 'full' | 'persistence'
}

interface PluginAgentToml {
  readonly plugin: string
  readonly source: AgentProfileSource
}

interface PluginWorkflowToml {
  readonly plugin: string
  readonly source: WorkflowSource
}

interface PluginMcpTool {
  readonly plugin: string
  readonly source: McpToolSource
}

export async function loadAssets(
  options: AssetLoadOptions
): Promise<{ assets: RuntimeAssets; dispose: () => Promise<void> }> {
  const { config, logger, delivery, childEnvBase, bootScope } = options
  const kernel = {
    logger,
    bus: createEventBus(logger),
    sessionQueue: createSessionQueue(),
    commandLane: createCommandLane(),
    childEnvBase,
  }

  if (bootScope === 'persistence') {
    return { assets: buildPersistenceAssets(kernel, delivery), dispose: async () => undefined }
  }

  const mcp = await connectMcpServers(config, logger)

  try {
    const plugins = await loadInstalledPlugins(config, logger)
    const [pluginAssets, userAgents, userWorkflows, pluginSourceModules] = await Promise.all([
      loadPluginAssets(plugins, mcp.tools, logger),
      readUserAgentsOrNone(config.paths.dataDir, logger),
      loadUserWorkflows(join(config.paths.dataDir, WORKFLOWS_DIR), logger),
      loadPluginSourceModules({
        modules: plugins.flatMap((plugin) => plugin.contributions.sourceModules ?? []),
        logger,
      }),
    ])

    const assets: RuntimeAssets = {
      kernel,
      delivery,
      plugins,
      pluginAssets,
      pluginSourceModules,
      mcpTools: mcp.tools,
      userAgents,
      userWorkflows,
    }

    return { assets, dispose: mcp.close }
  } catch (err: unknown) {
    await mcp.close()
    throw err
  }
}

// Boot has no registry to protect: an agents directory it cannot read starts the daemon with none,
// as it always has, and says so.
async function readUserAgentsOrNone(
  dataDir: string,
  logger: Logger
): Promise<readonly UserAgentSource[]> {
  try {
    return await readUserAgents(userAgentsDir(dataDir))
  } catch (err: unknown) {
    logger.warn('agents.read_failed', { err: formatErrForLog(err) })

    return []
  }
}

function buildPersistenceAssets(
  kernel: RuntimeAssets['kernel'],
  delivery: DeliveryHub
): RuntimeAssets {
  return {
    kernel,
    delivery,
    plugins: [],
    pluginAssets: {
      agentTomls: new Map(),
      externalMcpTools: new Map(),
      workflows: new Map(),
    },
    pluginSourceModules: [],
    mcpTools: [],
    userAgents: [],
    userWorkflows: [],
  }
}

async function loadPluginAssets(
  plugins: readonly Plugin[],
  mcpTools: readonly ToolDefinition[],
  logger: Logger
): Promise<PluginAssets> {
  const agentSources = pluginAgentTomls(plugins)
  const workflowSources = pluginWorkflowTomls(plugins)
  const [agentTomls, workflows] = await Promise.all([
    Promise.all(agentSources.map((entry) => readPluginAgentToml(entry, logger))),
    Promise.all(workflowSources.map((entry) => readPluginWorkflow(entry, logger))),
  ])

  return {
    agentTomls: new Map(agentTomls.filter(isDefined)),
    externalMcpTools: loadPluginMcpTools(plugins, mcpTools, logger),
    workflows: new Map(workflows.filter(isDefined)),
  }
}

function pluginAgentTomls(plugins: readonly Plugin[]): readonly PluginAgentToml[] {
  return plugins.flatMap((plugin) =>
    (plugin.contributions.agents ?? []).map((source) => ({ plugin: plugin.id, source }))
  )
}

function pluginWorkflowTomls(plugins: readonly Plugin[]): readonly PluginWorkflowToml[] {
  return plugins.flatMap((plugin) =>
    (plugin.contributions.workflows ?? []).map((source) => ({ plugin: plugin.id, source }))
  )
}

function pluginMcpTools(plugins: readonly Plugin[]): readonly PluginMcpTool[] {
  return plugins.flatMap((plugin) =>
    (plugin.contributions.externalMcpTools ?? []).map((source) => ({ plugin: plugin.id, source }))
  )
}

function loadPluginMcpTools(
  plugins: readonly Plugin[],
  connected: readonly ToolDefinition[],
  logger: Logger
): ReadonlyMap<string, ToolDefinition> {
  const available = new Map(connected.map((tool) => [tool.name, tool]))
  const loaded = new Map<string, ToolDefinition>()

  for (const entry of pluginMcpTools(plugins)) {
    const connectedTool = available.get(mcpToolName(entry.source))

    if (connectedTool === undefined) {
      logger.warn('plugin.mcp_tool_skipped', {
        plugin: entry.plugin,
        server: entry.source.server,
        tool: entry.source.tool,
        reason: 'not_connected',
      })

      continue
    }

    loaded.set(mcpToolSourceKey(entry.source), connectedTool)
  }

  return loaded
}

async function readPluginAgentToml(
  entry: PluginAgentToml,
  logger: Logger
): Promise<readonly [string, string] | undefined> {
  try {
    const text = await Bun.file(entry.source.tomlPath).text()

    assertAgentTomlMatchesSourceId(text, entry.source.id)

    return [entry.source.tomlPath, text]
  } catch (err: unknown) {
    logger.warn('plugin.agent_file_skipped', {
      plugin: entry.plugin,
      agent: entry.source.id,
      err: formatErrForLog(err),
    })

    return undefined
  }
}

async function readPluginWorkflow(
  entry: PluginWorkflowToml,
  logger: Logger
): Promise<readonly [string, ReturnType<typeof loadWorkflowToml>] | undefined> {
  try {
    const workflow = loadWorkflowToml(
      await Bun.file(entry.source.definitionPath).text(),
      entry.source.definitionPath
    )

    if (workflow.id !== entry.source.id) {
      throw new ConfigError(
        `plugin '${entry.plugin}' workflow '${entry.source.definitionPath}' declares '${workflow.id}', expected '${entry.source.id}'`
      )
    }

    return [entry.source.definitionPath, workflow]
  } catch (err: unknown) {
    logger.error('plugin.workflow_load_failed', {
      plugin: entry.plugin,
      workflow: entry.source.id,
      err: formatErrForLog(err),
    })

    return undefined
  }
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
