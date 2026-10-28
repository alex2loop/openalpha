import type { SlashCommand } from '@/core/types/command'

import { normalizeName, parseCommand } from './resolve'

const COMMAND_PREFIX = '/'
const WHITESPACE_RE = /\s+/
const TRAILING_WHITESPACE_RE = /\s$/

interface ArgumentCompletion {
  readonly command: SlashCommand
  /** What the position being typed accepts, filtered by the partial token and sorted. */
  readonly candidates: readonly string[]
}

/** The command a line names and what its next argument may be, or null while the name itself is
 *  still being typed or no command answers to it. The line parses as the dispatcher parses it, so
 *  `/Watchlist  ad` completes as `/watchlist ad`; a line ending in a space completes a fresh
 *  position from the empty partial token. */
export function completeArguments(
  commands: readonly SlashCommand[],
  line: string
): ArgumentCompletion | null {
  const typed = line.trimStart()
  const parsed = parseCommand(typed)

  if (parsed === null || !WHITESPACE_RE.test(typed)) {
    return null
  }

  const command = commands.find((entry) => entry.name === normalizeName(parsed.raw))

  if (command === undefined) {
    return null
  }

  const args = TRAILING_WHITESPACE_RE.test(typed) ? [...parsed.args, ''] : parsed.args
  const token = args.at(-1) ?? ''
  const matches = (command.completeFor?.(args) ?? []).filter((candidate) =>
    candidate.startsWith(token)
  )

  return { command, candidates: sortedUnique(matches) }
}

/** Every completion a terminal line offers: command names while the first word is typed, then the
 *  command's own arguments. */
export function completeLine(commands: readonly SlashCommand[], line: string): readonly string[] {
  const typed = line.trimStart()

  if (!typed.startsWith(COMMAND_PREFIX)) {
    return []
  }

  if (!WHITESPACE_RE.test(typed)) {
    const names = commands.map((command) => `${COMMAND_PREFIX}${command.name}`)

    return sortedUnique(names.filter((name) => name.startsWith(typed)))
  }

  return completeArguments(commands, typed)?.candidates ?? []
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}
