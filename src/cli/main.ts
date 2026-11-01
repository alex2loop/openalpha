import type { Command, CommandRejection, Group, LazyCommand, Needs } from '@/cli/command'
import type { CliApp } from '@/cli/types'
import { DEFAULT_NEEDS } from '@/cli/command'
import { resolveContributedCliCommands } from '@/cli/contributed'
import { isVerbose } from '@/cli/env'
import { printError } from '@/cli/error-output'
import { BUILT_IN_COMMANDS } from '@/cli/registry'
import { createRoot, toCommandArgv } from '@/cli/root'

type CommandPreflight =
  | { readonly kind: 'ready'; readonly needs: Required<Needs> }
  | { readonly kind: 'rejected'; readonly rejection: CommandRejection }

export async function preflightCommand(
  argv: readonly string[],
  extraCommands: readonly (Command | Group)[] = []
): Promise<CommandPreflight> {
  const known = [...BUILT_IN_COMMANDS, ...extraCommands]
  const root = createRoot(known)
  const rejection = await root.preflight(argv, [])

  if (rejection !== undefined) {
    // A head no static command claims may be a contributed command that only exists after boot:
    // run the full boot and let the booted root resolve or reject it with complete suggestions.
    if (isUnknownRootHead(argv, root.subcommands)) {
      return { kind: 'ready', needs: DEFAULT_NEEDS }
    }

    return { kind: 'rejected', rejection }
  }

  const needs = await root.needsFor(argv)

  return { kind: 'ready', needs }
}

function isUnknownRootHead(
  argv: readonly string[],
  commands: readonly (Command | Group)[]
): boolean {
  const head = argv[0]

  return head !== undefined && !head.startsWith('-') && !commands.some((cmd) => cmd.name === head)
}

export function resolveCliCommands(
  app: CliApp,
  extra: readonly (Command | Group)[]
): readonly (Command | Group)[] {
  return [...extra, ...resolveContributedCliCommands(app, [...BUILT_IN_COMMANDS, ...extra])]
}

// The command and subcommand names argv reaches, stopping at the first token that is no name, so
// no argument value is ever in it.
export async function resolveCommandPath(
  argv: readonly string[],
  commands: readonly (Command | Group)[]
): Promise<readonly string[]> {
  const path: string[] = []
  let tokens = toCommandArgv(argv)
  let match = findEntry(createRoot([...BUILT_IN_COMMANDS, ...commands]).subcommands, tokens[0])

  while (match !== undefined) {
    path.push(match.name)

    const node = isLazy(match) ? await match.load() : match

    if (node.kind === 'cmd') {
      break
    }

    tokens = tokens.slice(1)
    match = findEntry(node.subcommands, tokens[0])
  }

  return path
}

function findEntry(
  entries: readonly (Command | Group)[],
  head: string | undefined
): Command | Group | undefined {
  return head === undefined ? undefined : entries.find((entry) => entry.name === head)
}

function isLazy(entry: Command | Group): entry is LazyCommand {
  return 'load' in entry
}

export async function runCli(
  app: CliApp,
  argv: readonly string[],
  extraCommands: readonly (Command | Group)[] = []
): Promise<number> {
  try {
    return await createRoot([...BUILT_IN_COMMANDS, ...extraCommands]).exec(argv, app, [])
  } catch (err: unknown) {
    return printError(err, {
      write: app.err,
      verbose: isVerbose(),
      locale: app.config.locale.language,
    })
  }
}
