import type { LocaleLookup } from '@/commands/dispatcher/render'
import type { CommandGroup, SlashCommand } from '@/core/types/command'
import { describeCommand } from '@/commands/dispatcher/render'

const VERB_WIDTH = 13
const ROW_INDENT = '  '
const GENERAL_GROUP: CommandGroup = Object.freeze({ key: 'slash.helpGroupGeneral', icon: '💬' })

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

interface HelpSection {
  readonly group: CommandGroup
  readonly entries: HelpControl[]
}

/** One help layout for every surface. Surfaces differ only in which verbs they hand in — the
 *  grouping, the column width, and how a description resolves are settled here, so `/help` cannot
 *  read one way in the terminal and another in a chat. The surface's own verbs and every command
 *  naming no group head the list; the rest follow by group, in registration order. */
export function renderCommandHelp(i18n: LocaleLookup, options: CommandHelpOptions): string {
  const sections: HelpSection[] = [{ group: GENERAL_GROUP, entries: [...options.controls] }]

  for (const command of options.commands) {
    const group = command.group ?? GENERAL_GROUP
    const entry = {
      verb: `/${command.name}`,
      description: describeCommand(i18n, command.description),
    }
    const section = sections.find((candidate) => candidate.group.key === group.key)

    if (section === undefined) {
      sections.push({ group, entries: [entry] })
    } else {
      section.entries.push(entry)
    }
  }

  return sections
    .map((section) =>
      [
        `${section.group.icon} ${i18n.translate(section.group.key)}`,
        ...section.entries.map(
          (entry) => `${ROW_INDENT}${entry.verb.padEnd(VERB_WIDTH)} ${entry.description}`
        ),
      ].join('\n')
    )
    .join('\n\n')
}
