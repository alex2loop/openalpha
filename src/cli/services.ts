import type { ChatDisplay } from '@/cli/commands/chat/types'
import type { CliApp, CompletionSource } from '@/cli/types'
import type { AgentId } from '@/core/ids'
import type { SlashCommand } from '@/core/types/command'
import type { McpJobs, McpSurface, SkillCatalog } from '@/engine/api'
import { completeLine } from '@/commands/api'
import { sanitizeDisplayText } from '@/core/utils/text'

const SOURCE_ENTRY_SUFFIX = 'main.ts'
// Read once at load: a binary replaced while it runs may report a changed path afterwards.
const SELF_PATH = process.execPath

// CLI commands receive typed service access through this wiring layer rather than calling the
// container directly from command behavior.
export function resolveMcpSurface(app: CliApp): McpSurface {
  return app.resolve('mcpSurface')
}

export function resolveMcpJobs(app: CliApp): McpJobs {
  return app.resolve('mcpJobs')
}

export function resolveSkillCatalog(app: CliApp): SkillCatalog {
  return app.resolve('skillCatalog')
}

/** The file actually loaded, with `--config` applied. Every app carries it — the probe sets it
 *  pre-boot and `loadConfig` at boot — while `configProbe` exists only pre-boot, so a booted
 *  caller reading the probe falls back to a guess for a file it already holds. */
export function resolveConfigPath(app: CliApp): string {
  return app.configPath
}

export interface SelfCommand {
  readonly command: string
  readonly args: readonly string[]
}

/** `process.execPath` is `bun` in a source run, so the entry file rides along. argv[1] is a virtual
 *  path inside a compiled binary, which only the source entry can be re-executed with, so the
 *  binary is left as its own entry. */
export function resolveSelfCommand(): SelfCommand {
  const entry = process.argv[1]

  return {
    command: SELF_PATH,
    args: entry?.endsWith(SOURCE_ENTRY_SUFFIX) === true ? [entry] : [],
  }
}

/** The data dir is always named, and the config file whenever it exists, so a restart loads the same
 *  files whatever directory it runs from. A missing one stays unnamed: an explicit `--config` to a
 *  missing file is an error where the default one is simply absent. */
export async function buildSelfArgv(options: {
  readonly dataDir: string
  readonly configPath: string
  readonly tail: readonly string[]
}): Promise<string[]> {
  const { command, args } = resolveSelfCommand()
  const hasConfig = await Bun.file(options.configPath).exists()
  const config = hasConfig ? ['--config', options.configPath] : []

  return [command, ...args, '--data-dir', options.dataDir, ...config, ...options.tail]
}

export function resolveChatDisplay(app: CliApp, agentId: AgentId): ChatDisplay {
  const agent = app.resolve('agents').get(agentId)

  return {
    agentName: sanitizeDisplayText(agent?.name ?? agentId),
    model: sanitizeDisplayText(agent?.model ?? 'unavailable'),
  }
}

export function resolveChatCompletion(app: CliApp): CompletionSource {
  return createChatCompletionSource(app.resolve('slashDispatcher').all())
}

function createChatCompletionSource(commands: readonly SlashCommand[]): CompletionSource {
  return { complete: (line) => completeLine(commands, line) }
}
