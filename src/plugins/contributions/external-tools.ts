import type { ToolDefinition } from '@/core/tool'
import type { McpToolSource, Plugin } from '@/core/types/plugin'
import { trustedForCode } from '@/plugins/contributions/merge'

const MCP_TOOL_PREFIX = 'mcp__'
const MCP_TOOL_SEPARATOR = '__'

interface MergeExternalMcpToolsOptions {
  readonly current: ReadonlyMap<string, ToolDefinition>
  readonly plugins: readonly Plugin[]
  readonly bundled: ReadonlySet<Plugin>
  readonly loaded: ReadonlyMap<string, ToolDefinition>
}

export function mcpToolName(source: McpToolSource): string {
  return `${MCP_TOOL_PREFIX}${source.server}${MCP_TOOL_SEPARATOR}${source.tool}`
}

export function mcpToolSourceKey(source: McpToolSource): string {
  return JSON.stringify([source.server, source.tool])
}

export function mergeExternalMcpTools(
  options: MergeExternalMcpToolsOptions
): ReadonlyMap<string, ToolDefinition> {
  const { current, plugins, bundled, loaded } = options
  const next = new Map(current)

  for (const plugin of trustedForCode(plugins, bundled)) {
    for (const source of plugin.contributions.externalMcpTools ?? []) {
      const tool = loaded.get(mcpToolSourceKey(source))

      if (tool !== undefined && !next.has(tool.name)) {
        next.set(tool.name, tool)
      }
    }
  }

  return next
}
