import type { Logger } from '@/core/logging/logger'
import type { ToolDefinition } from '@/core/tool'
import type { CliCommandDef } from '@/core/types/cli-command'
import type { SlashCommand } from '@/core/types/command'
import type { ChannelDefinitionRef, DeclarativeChannelSource, Plugin } from '@/core/types/plugin'
import { ConfigError } from '@/core/errors'

// Tools, slash-command handlers, and CLI command definitions are executable code: only bundled
// (trusted) plugins may contribute them — invariant "untrusted plugins cannot contribute code".
// Declarative command sources use runtime-owned handlers in services.ts; channels and workflows
// resolve their own refs.
export function mergeTools(
  current: readonly ToolDefinition[],
  plugins: readonly Plugin[],
  bundled: ReadonlySet<Plugin>
): readonly ToolDefinition[] {
  return mergeUniqueCodeByKey({
    current,
    additions: trustedForCode(plugins, bundled).flatMap(
      (plugin) => plugin.contributions.tools ?? []
    ),
    key: (tool) => tool.name,
    label: 'tool name',
  })
}

export function mergeSlashCommands(
  current: readonly SlashCommand[],
  plugins: readonly Plugin[],
  bundled: ReadonlySet<Plugin>
): readonly SlashCommand[] {
  return mergeUniqueCodeByKey({
    current,
    additions: trustedForCode(plugins, bundled).flatMap(
      (plugin) => plugin.contributions.slashCommands ?? []
    ),
    key: (item) => item.name,
    label: 'slash command name',
  })
}

export function mergeCliCommands(
  current: readonly CliCommandDef[],
  plugins: readonly Plugin[],
  bundled: ReadonlySet<Plugin>
): readonly CliCommandDef[] {
  return mergeUniqueCodeByKey({
    current,
    additions: trustedForCode(plugins, bundled).flatMap(
      (plugin) => plugin.contributions.cliCommands ?? []
    ),
    key: (item) => item.name,
    label: 'CLI command name',
  })
}

export function mergeChannelDefinitions(
  current: readonly ChannelDefinitionRef[],
  plugins: readonly Plugin[],
  bundled: ReadonlySet<Plugin>
): readonly ChannelDefinitionRef[] {
  return mergeUniqueCodeByKey({
    current,
    additions: trustedForCode(plugins, bundled).flatMap(
      (plugin) => plugin.contributions.channels ?? []
    ),
    key: (item) => item.id,
    label: 'channel id',
  })
}

export function mergeDeclarativeChannels(
  current: readonly DeclarativeChannelSource[],
  plugins: readonly Plugin[],
  logger: Logger
): readonly DeclarativeChannelSource[] {
  const map = new Map(current.map((item) => [item.adapter, item]))

  for (const plugin of plugins) {
    for (const item of plugin.contributions.declarativeChannels ?? []) {
      if (map.has(item.adapter)) {
        logger.warn('plugins.channel_adapter_taken', { plugin: plugin.id, adapter: item.adapter })

        continue
      }

      map.set(item.adapter, item)
    }
  }

  return [...map.values()]
}

export function trustedForCode(
  plugins: readonly Plugin[],
  bundled: ReadonlySet<Plugin>
): readonly Plugin[] {
  return plugins.filter((plugin) => bundled.has(plugin))
}

function mergeUniqueCodeByKey<T>(options: {
  readonly current: readonly T[]
  readonly additions: readonly T[]
  readonly key: (item: T) => string
  readonly label: string
}): readonly T[] {
  const { current, additions, key, label } = options
  const map = new Map(current.map((item) => [key(item), item]))

  for (const item of additions) {
    const itemKey = key(item)

    if (map.has(itemKey)) {
      throw new ConfigError(`duplicate ${label}: ${itemKey}`)
    }
    map.set(itemKey, item)
  }

  return [...map.values()]
}
