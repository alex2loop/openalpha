import type { Plugin } from '@/core/types/plugin'
import { ConfigError } from '@/core/errors'

export const isBundledId = (id: string, bundledIds: ReadonlySet<string>): boolean =>
  bundledIds.has(id)

export function assertBundledPlugins(plugins: readonly Plugin[]): void {
  assertUnique(
    plugins.map((plugin) => plugin.id),
    'plugin id'
  )
  assertUnique(
    plugins.flatMap((plugin) => plugin.contributions.tools?.map((tool) => tool.name) ?? []),
    'tool name'
  )
  assertUnique(
    plugins.flatMap((plugin) => plugin.contributions.agents?.map((agent) => agent.id) ?? []),
    'agent id'
  )
  assertUnique(
    plugins.flatMap(
      (plugin) => plugin.contributions.slashCommands?.map((command) => command.name) ?? []
    ),
    'slash command name'
  )
  assertUnique(
    plugins.flatMap(
      (plugin) => plugin.contributions.cliCommands?.map((command) => command.name) ?? []
    ),
    'CLI command name'
  )
}

function assertUnique(items: readonly string[], label: string): void {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item)) {
      throw new ConfigError(`duplicate ${label}: ${item}`)
    }
    seen.add(item)
  }
}
