import type {
  CommandRole,
  CommandSurface,
  SlashCommand,
  SlashInvocationPolicy,
  SlashResult,
} from '@/core/types/command'
import { closestName } from '@/core/utils/text'

import type { ResolvedSlashCommand } from '../types'
import { unexpectedResult } from './result'

const COMMAND_PREFIX = '/'
const BOT_MENTION_RE = /@[^\s]+$/
const LEADING_SLASH_RE = /^\//
const WHITESPACE_RE = /\s+/
const UNKNOWN_COMMAND_KEY = 'slash.unknownCommand'
const NEAR_COMMAND_KEY = 'slash.unknownCommandNear'
// Each surface answers it before the dispatcher; a typo can still mean it.
const HELP_COMMAND_NAME = 'help'

export const HELP_COMMAND = `${COMMAND_PREFIX}${HELP_COMMAND_NAME}`

interface ParsedCommand {
  readonly raw: string
  readonly args: readonly string[]
}

export function parseCommand(line: string): ParsedCommand | null {
  if (!line.startsWith(COMMAND_PREFIX)) {
    return null
  }

  const tokens = line.slice(1).trim().split(WHITESPACE_RE).filter(Boolean)
  const raw = tokens.shift()

  return raw === undefined ? null : { raw, args: tokens }
}

export function normalizeName(name: string): string {
  return name.replace(LEADING_SLASH_RE, '').replace(BOT_MENTION_RE, '').toLowerCase()
}

/** The command a line invokes, the way the dispatcher names it (`/Stop@MyBot now` -> `/stop`), or
 *  null for a line that is not a command. */
export function commandHeadOf(line: string): string | null {
  const parsed = parseCommand(line.trim())

  return parsed === null ? null : `${COMMAND_PREFIX}${normalizeName(parsed.raw)}`
}

export function isCommandVisible(
  policy: SlashInvocationPolicy,
  surface?: CommandSurface,
  role?: CommandRole
): boolean {
  if (surface !== undefined && !policy.surfaces.includes(surface)) {
    return false
  }
  if (role !== undefined && !isRoleAllowed(policy.role, role)) {
    return false
  }
  return true
}

export function isRoleAllowed(required: CommandRole, actual: CommandRole): boolean {
  if (actual === 'operator') {
    return true
  }
  return required === 'member'
}

interface SuggestCommandNameOptions {
  readonly commands: Map<string, SlashCommand>
  readonly target: string
  readonly surface: CommandSurface
  readonly role: CommandRole
}

export function suggestCommandName(options: SuggestCommandNameOptions): string | null {
  const { commands, target, surface, role } = options
  const visible = [...commands.values()]
    .filter((cmd) => isCommandVisible(cmd.policy, surface, role))
    .map((cmd) => cmd.name)
  return closestName(target, [HELP_COMMAND_NAME, ...visible]) ?? null
}

interface DispatchLineOptions {
  readonly line: string
  readonly resolve: (raw: string, args: readonly string[]) => ResolvedSlashCommand | null
  /** The nearest visible command name, or null. Owned here so a typo reads the same on every
   *  surface instead of one of them answering with a bare "unknown command". */
  readonly suggest: (raw: string) => string | null
  readonly runResolved: (resolved: ResolvedSlashCommand) => Promise<SlashResult>
}

export async function dispatchLine(options: DispatchLineOptions): Promise<SlashResult | null> {
  const { line, resolve, runResolved } = options

  if (!line.startsWith(COMMAND_PREFIX)) {
    return null
  }

  const parsed = parseCommand(line)

  if (parsed === null) {
    return unexpectedResult()
  }

  const resolved = resolve(parsed.raw, parsed.args)

  if (resolved === null) {
    const near = options.suggest(parsed.raw)

    return near === null
      ? { kind: 'message', messages: [{ key: UNKNOWN_COMMAND_KEY }] }
      : { kind: 'message', messages: [{ key: NEAR_COMMAND_KEY, values: { near } }] }
  }

  return runResolved(resolved)
}
