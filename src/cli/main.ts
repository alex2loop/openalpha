import type { Command, CommandRejection, Group, Needs } from '@/cli/command'
import type { CliApp } from '@/cli/types'
import { createRoot, DEFAULT_NEEDS } from '@/cli/command'
import { isVerbose } from '@/cli/env'
import { printError } from '@/cli/error-output'
import { BUILT_IN_COMMANDS } from '@/cli/registry'

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
    if (isUnknownRootHead(argv, known)) {
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
