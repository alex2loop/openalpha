import type { BootExtensionOptions } from '@/app/types'
import type { ChannelDefinition } from '@/channels/api'
import type { App, ServiceProvider } from '@/core/container'
import type { ToolDefinition } from '@/core/tool'
import type { SlashCommand } from '@/core/types/command'
import type { AgentDefinition, AgentProfile } from '@/engine/api'
import { collectSlashCommandIssues } from '@/commands/api'
import { ConfigError, ValidationError } from '@/core/errors'
import { scrubCredentials } from '@/core/security/credentials'
import { buildAgentDefinition, collectAgentReferenceIssues } from '@/engine/api'

const BOOT_EXTENSION_PROVIDER_NAME = 'boot-extensions'
const AGGREGATE_ERROR_HEADING = 'boot extension validation failed'

// Only the typed errors that represent an expected definition failure are caught and aggregated;
// every other thrown value is unexpected and propagates unchanged.
const EXPECTED_ERROR_TYPES = new Set<unknown>([ConfigError, ValidationError])

interface BootExtensionRegistration {
  readonly provider: ServiceProvider
  assertRegistered(app: App): void
}

export function createBootExtensionRegistration(
  options: BootExtensionOptions
): BootExtensionRegistration {
  // Per-boot mutable collector: bounded by boot-option cardinality, captured by the returned
  // closures, never shared across boots.
  const issues: string[] = []

  const provider: ServiceProvider = {
    name: BOOT_EXTENSION_PROVIDER_NAME,
    register(_bind, extend): void {
      extend('tools', (current) =>
        mergeToolsExtension(options.extensions.tools ?? [], current, issues)
      )
      extend('agents', (current, app) =>
        mergeAgentsExtension({
          additions: options.extensions.agents ?? [],
          current,
          app,
          issues,
        })
      )
      extend('commands', (current) =>
        mergeCommandsExtension({
          additions: options.extensions.slashCommands ?? [],
          current,
          keys: options.keys,
          issues,
        })
      )
      extend('channels', (current) =>
        mergeChannelsExtension(options.extensions.channels ?? [], current, issues)
      )
    },
  }

  function assertRegistered(app: App): void {
    // Force every affected service to resolve: each extender always returns a merge result, so an
    // exception escaping resolution is unexpected and propagates unchanged.
    app.resolve('tools')
    app.resolve('agents')
    app.resolve('slashDispatcher')
    app.resolve('channels')

    if (issues.length > 0) {
      const detail = issues.map((issue) => `  - ${issue}`).join('\n')
      throw new ConfigError(`${AGGREGATE_ERROR_HEADING}:\n${detail}`)
    }
  }

  return { provider, assertRegistered }
}

function mergeToolsExtension(
  additions: readonly ToolDefinition[],
  current: ReadonlyMap<string, ToolDefinition>,
  issues: string[]
): ReadonlyMap<string, ToolDefinition> {
  const merged = mergeUniqueExtensions({
    additions,
    current: [...current.values()],
    key: (tool) => tool.name,
    label: 'tool name',
    issues,
  })

  return new Map(merged.map((tool) => [tool.name, tool]))
}

interface AgentMergeOptions {
  readonly additions: readonly AgentDefinition[]
  readonly current: ReadonlyMap<string, AgentProfile>
  readonly app: App
  readonly issues: string[]
}

function mergeAgentsExtension(options: AgentMergeOptions): ReadonlyMap<string, AgentProfile> {
  const { additions, current, app, issues } = options
  const toolNames = [...app.resolve('tools').keys()]
  // The full candidate id set lets a forward delegate reference resolve against same-bag agents.
  const candidateIds = additions.map((def) => def.id)
  const built = new Map<string, AgentProfile>(current)
  const existingIds = new Set<string>(current.keys())
  const processed = new Set<string>()

  for (const def of additions) {
    if (recordDuplicateAgent({ id: def.id, existingIds, processed, issues })) {
      continue
    }

    processed.add(def.id)

    const referenceIssues = collectAgentReferenceIssues({
      id: def.id,
      toolNames,
      agentIds: [...existingIds, ...candidateIds],
      ...(def.capabilities?.tools === undefined ? {} : { tools: def.capabilities.tools }),
      ...(def.capabilities?.delegates === undefined
        ? {}
        : { delegates: def.capabilities.delegates }),
    })

    if (referenceIssues.length > 0) {
      for (const issue of referenceIssues) {
        recordIssue(issues, issue)
      }
      continue
    }

    try {
      const profile = buildAgentDefinition(def, { config: app.config, allToolNames: toolNames })
      built.set(profile.id, profile)
      existingIds.add(profile.id)
    } catch (err: unknown) {
      recordExpectedError(issues, err, `agent '${def.id}'`)
    }
  }

  return built
}

interface DuplicateAgentOptions {
  readonly id: string
  readonly existingIds: Set<string>
  readonly processed: Set<string>
  readonly issues: string[]
}

/** Records a collision against the registry or a repeat within the input; returns true when found. */
function recordDuplicateAgent(options: DuplicateAgentOptions): boolean {
  const { id, existingIds, processed, issues } = options

  if (existingIds.has(id)) {
    recordIssue(issues, `duplicate agent id '${id}' collides with an existing registration`)
    return true
  }

  if (processed.has(id)) {
    recordIssue(issues, `duplicate agent id '${id}' repeated in boot options`)
    return true
  }

  return false
}

interface CommandMergeOptions {
  readonly additions: readonly SlashCommand[]
  readonly current: readonly SlashCommand[]
  readonly keys: BootExtensionOptions['keys']
  readonly issues: string[]
}

function mergeCommandsExtension(options: CommandMergeOptions): readonly SlashCommand[] {
  const { additions, current, keys, issues } = options
  const merged = mergeUniqueExtensions({
    additions,
    current,
    key: (command) => command.name,
    label: 'slash command name',
    issues,
    validate: (command) => {
      const commandIssues = collectSlashCommandIssues(command, { keys })
      return commandIssues.length === 0 ? undefined : commandIssues[0]
    },
  })

  return merged
}

function mergeChannelsExtension(
  additions: readonly ChannelDefinition[],
  current: readonly ChannelDefinition[],
  issues: string[]
): readonly ChannelDefinition[] {
  return mergeUniqueExtensions({
    additions,
    current,
    key: (channel) => channel.id,
    label: 'channel id',
    issues,
  })
}

interface MergeUniqueExtensionsOptions<T> {
  readonly additions: readonly T[]
  readonly current: readonly T[]
  readonly key: (item: T) => string
  readonly label: string
  readonly issues: string[]
  /** Optional per-entry validator; first issue returned blocks the entry. */
  readonly validate?: (item: T) => string | undefined
}

/**
 * App-local collision/iteration mechanic only. Domain validation wording stays with each domain
 * helper. Keeps the first valid entry; an invalid entry does not reserve its key, the first valid
 * one does. Preserves input order and current order.
 */
function mergeUniqueExtensions<T>(options: MergeUniqueExtensionsOptions<T>): readonly T[] {
  const { additions, current, key, label, issues, validate } = options
  const merged = new Map<string, T>(current.map((item) => [key(item), item]))
  const seen = new Set<string>(merged.keys())

  for (const item of additions) {
    const itemKey = key(item)

    if (validate !== undefined) {
      const validationIssue = validate(item)
      if (validationIssue !== undefined) {
        recordIssue(issues, validationIssue)
        continue
      }
    }

    if (merged.has(itemKey)) {
      recordIssue(issues, `duplicate ${label} '${itemKey}' collides with an existing registration`)
      continue
    }

    if (seen.has(itemKey)) {
      recordIssue(issues, `duplicate ${label} '${itemKey}' repeated in boot options`)
      continue
    }

    merged.set(itemKey, item)
    seen.add(itemKey)
  }

  return [...merged.values()]
}

// One owner for issue storage: every collected message is scrubbed before it lands in the list,
// whether it came from a domain collector, a collision, or a caught typed error.
function recordIssue(issues: string[], message: string): void {
  issues.push(scrubCredentials(message))
}

function recordExpectedError(issues: string[], err: unknown, context: string): void {
  for (const type of EXPECTED_ERROR_TYPES) {
    // why-safe: EXPECTED_ERROR_TYPES holds only Error subclass constructors, and `instanceof`
    // having just matched one is itself the proof that `err` is an Error.
    if (err instanceof (type as { new (...args: unknown[]): Error })) {
      recordIssue(issues, `${context}: ${(err as Error).message}`)
      return
    }
  }

  throw err
}
