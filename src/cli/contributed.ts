import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp, LocalizedText } from '@/cli/types'
import type {
  CliArgValue,
  CliCommandDef,
  CliContext,
  CliParsedArgs,
} from '@/core/types/cli-command'
import { type Command, createCommand, type Group } from '@/cli/command'
import { ConfigError } from '@/core/errors'
import { hasOwnMessage } from '@/i18n'

const CLI_COMMAND_NAME_RE = /^[a-z][a-z0-9]*$/
const CLI_SUMMARY_KEY_RE = /^cliHelp\.[A-Za-z][A-Za-z0-9]*$/

/** The one gate and adapter for container-contributed CLI commands: a name unique against the static
 *  root, and a summary key present in every catalog — the composition bar the slash dispatcher also
 *  applies. Throws so the entry reports it like any other boot failure. */
export function resolveContributedCliCommands(
  app: CliApp,
  reserved: readonly (Command | Group)[]
): readonly Command[] {
  const defs = app.resolve('cliCommands')
  const taken = new Set(reserved.map((command) => command.name))
  const commands: Command[] = []

  for (const def of defs) {
    assertContributedCommandValid(def, taken)
    taken.add(def.name)
    commands.push(toCommand(def))
  }

  return commands
}

function assertContributedCommandValid(def: CliCommandDef, taken: ReadonlySet<string>): void {
  if (!CLI_COMMAND_NAME_RE.test(def.name)) {
    throw new ConfigError(`invalid contributed CLI command name: ${def.name}`)
  }

  if (taken.has(def.name)) {
    throw new ConfigError(`duplicate CLI command name: ${def.name}`)
  }

  if (!(CLI_SUMMARY_KEY_RE.test(def.summary.key) && resolvesEverywhere(def.summary.key))) {
    throw new ConfigError(
      `CLI command '${def.name}' summary key missing from a locale catalog: ${def.summary.key}`
    )
  }
}

// The commands provider's contract, restated because cli cannot import app and threading it through
// main would widen two signatures for one closed predicate.
function resolvesEverywhere(key: string): boolean {
  return hasOwnMessage('en', key) && hasOwnMessage('vi', key)
}

function toCommand(def: CliCommandDef): Command {
  // why-safe: the shape and catalog membership were asserted above, and `t` returns the key
  // unchanged if a catalog ever drops it.
  const summary: LocalizedText = {
    key: def.summary.key as LocalizedText['key'],
    ...(def.summary.params === undefined ? {} : { params: def.summary.params }),
  }

  return createCommand({
    name: def.name,
    summary,
    ...(def.spec === undefined ? {} : { spec: def.spec }),
    run: (args, app) => def.run(toContributedArgs(args), toCliContext(app)),
  })
}

function toContributedArgs(parsed: ParsedArgs): CliParsedArgs {
  const out: Record<string, CliArgValue> = {}

  for (const [name, value] of Object.entries(parsed)) {
    if (name === 'issues') {
      continue
    }

    if (typeof value === 'string' || Array.isArray(value)) {
      // why-safe: the only ArgIssue[] value in ParsedArgs lives under 'issues', skipped above.
      out[name] = value as CliArgValue
    }
  }

  return out
}

function toCliContext(app: CliApp): CliContext {
  return {
    locale: app.config.locale.language,
    signal: app.signal,
    out: app.out,
    err: app.err,
  }
}
