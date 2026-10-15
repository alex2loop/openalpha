import type { ChannelId } from '@/core/channels'
import type { DaemonTask } from '@/core/container'
import type { AgentId } from '@/core/ids'
import type { ToolDefinition } from '@/core/tool'
import type { CliCommandDef } from '@/core/types/cli-command'
import type { SlashCommand } from '@/core/types/command'
export interface AgentProfileSource {
  readonly id: AgentId
  readonly tomlPath: string
}

export interface ChannelDefinitionRef {
  readonly id: ChannelId
  create(): unknown
}

/** A disk plugin selects an existing adapter; the channels module supplies its implementation. */
export interface DeclarativeChannelSource {
  readonly adapter: ChannelId
  readonly config: Readonly<Record<string, unknown>>
}

export type DeclarativeSlashCommandSource =
  | {
      readonly name: string
      readonly description: string
      readonly target: {
        readonly kind: 'agent'
        readonly id: AgentId
        readonly prompt: string
      }
    }
  | {
      readonly name: string
      readonly description: string
      readonly target: {
        readonly kind: 'workflow'
        readonly id: string
      }
    }

/** A disk plugin can expose only a tool already connected through operator-owned MCP config. */
export interface McpToolSource {
  readonly server: string
  readonly tool: string
}

export interface WorkflowSource {
  readonly id: string
  readonly definitionPath: string
}

export interface ApiRouteSource {
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly handlerPath: string
}

/** A path, never a loaded module: `plugins` does not know what a source is, and `trading` does not
 *  know what a plugin is. */
export interface PluginSourceModule {
  readonly pluginId: string
  readonly modulePath: string
}

export interface PluginContributions {
  readonly tools?: readonly ToolDefinition[]
  readonly agents?: readonly AgentProfileSource[]
  readonly slashCommands?: readonly SlashCommand[]
  readonly cliCommands?: readonly CliCommandDef[]
  readonly channels?: readonly ChannelDefinitionRef[]
  readonly workflows?: readonly WorkflowSource[]
  readonly declarativeChannels?: readonly DeclarativeChannelSource[]
  readonly declarativeSlashCommands?: readonly DeclarativeSlashCommandSource[]
  readonly externalMcpTools?: readonly McpToolSource[]
  readonly daemonTasks?: readonly DaemonTask[]
  readonly apiRoutes?: readonly ApiRouteSource[]
  readonly skillsDirs?: readonly string[]
  readonly sourceModules?: readonly PluginSourceModule[]
}

export interface Plugin {
  readonly id: string
  readonly contributions: PluginContributions
}
