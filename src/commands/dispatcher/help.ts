import type { LocaleLookup } from '@/commands/dispatcher/render'
import type { SlashCommand } from '@/core/types/command'
import { describeCommand } from '@/commands/dispatcher/render'

const VERB_WIDTH = 12

/** A verb the surface answers itself — `/stop` in a channel, `/exit` in the REPL. It never reaches
 *  the dispatcher, so only the surface can name it. */
export interface HelpControl {
  readonly verb: string
  readonly description: string
}

export interface CommandHelpOptions {
  readonly controls: readonly HelpControl[]
  readonly commands: readonly SlashCommand[]
}

/** One help layout for every surface. Surfaces differ only in which verbs they hand in — the
 *  ordering, the column width, and how a description resolves are settled here, so `/help` cannot
 *  read one way in the terminal and another in a chat. */
export function renderCommandHelp(i18n: LocaleLookup, options: CommandHelpOptions): string {
  const registered = options.commands.map((command) => ({
    verb: `/${command.name}`,
    description: describeCommand(i18n, command.description),
  }))

  return [...options.controls, ...registered]
    .map((entry) => `${entry.verb.padEnd(VERB_WIDTH)} ${entry.description}`)
    .join('\n')
}
