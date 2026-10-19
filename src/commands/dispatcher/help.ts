import type { LocaleLookup } from '@/commands/dispatcher/render'
import type { CommandGroup, SlashCommand } from '@/core/types/command'
import { describeCommand, renderCommandText, renderMessages } from '@/commands/dispatcher/render'
import {
  commandHeadOf,
  HELP_COMMAND,
  normalizeName,
  parseCommand,
} from '@/commands/dispatcher/resolve'
import { closestName } from '@/core/utils/text'

const ROW_INDENT = '  '
const UNKNOWN_TOPIC_KEY = 'slash.helpTopicUnknown'
const NEAR_TOPIC_KEY = 'slash.helpTopicNear'
const SYSTEM_GROUP: CommandGroup = Object.freeze({ key: 'slash.helpGroupSystem', icon: '⚙️' })

/** A verb the surface answers itself — `/stop` in a channel, `/exit` in the REPL. It never reaches
 *  the dispatcher, so only the surface can name it. */
export interface HelpControl {
  readonly verb: string
  readonly description: string
}

/** What a `/help` line asks for: the whole list, or the one command named after it. */
export interface HelpRequest {
  readonly topic?: string
}

export interface CommandHelpOptions extends HelpRequest {
  readonly controls: readonly HelpControl[]
  readonly commands: readonly SlashCommand[]
}

export interface HelpSection {
  readonly group: CommandGroup
  readonly entries: readonly HelpControl[]
}

/** The `/help` request a line makes, or null for any other line. Parsed as the dispatcher parses a
 *  command, so `/Help@MyBot suggest` reads the same as `/help suggest`. */
export function parseHelpLine(line: string): HelpRequest | null {
  if (commandHeadOf(line) !== HELP_COMMAND) {
    return null
  }

  const [topic] = parseCommand(line.trim())?.args ?? []

  return topic === undefined ? {} : { topic }
}

/** One help layout for every surface. Surfaces differ only in which verbs they hand in — the
 *  grouping and how a description resolves are settled here, so `/help` cannot read one way in the
 *  terminal and another in a chat. The grouped commands lead, by group in registration order; the
 *  system group closes the list with the surface's own verbs, then every command naming no group. */
export function renderCommandHelp(i18n: LocaleLookup, options: CommandHelpOptions): string {
  return options.topic === undefined
    ? renderCommandList(i18n, options)
    : renderCommandTopic(i18n, options, options.topic)
}

function renderCommandList(i18n: LocaleLookup, options: CommandHelpOptions): string {
  return buildHelpSections(i18n, options)
    .map((section) =>
      [
        `${section.group.icon} ${i18n.translate(section.group.key)}`,
        ...section.entries.map((entry) => `${ROW_INDENT}${toHelpRow(entry)}`),
      ].join('\n')
    )
    .join('\n\n')
}

/** The list `/help` prints, as data: grouped commands first, then one system section holding the
 *  surface's controls followed by every ungrouped command. The chat menu flattens the same list. */
export function buildHelpSections(
  i18n: LocaleLookup,
  options: Omit<CommandHelpOptions, 'topic'>
): readonly HelpSection[] {
  const grouped: { group: CommandGroup; entries: HelpControl[] }[] = []
  const system: HelpControl[] = [...options.controls]

  for (const command of options.commands) {
    const entry = {
      verb: `/${command.name}`,
      description: describeCommand(i18n, command.description),
    }
    const section = grouped.find((candidate) => candidate.group.key === command.group?.key)

    if (command.group === undefined) {
      system.push(entry)
    } else if (section === undefined) {
      grouped.push({ group: command.group, entries: [entry] })
    } else {
      section.entries.push(entry)
    }
  }

  return system.length === 0 ? grouped : [...grouped, { group: SYSTEM_GROUP, entries: system }]
}

/** A command's description, then the usage it answers a bad line with. A name nothing answers to
 *  gets the nearest one and the way back to the list. */
function renderCommandTopic(
  i18n: LocaleLookup,
  options: CommandHelpOptions,
  topic: string
): string {
  const name = normalizeName(topic)
  const control = options.controls.find((candidate) => normalizeName(candidate.verb) === name)

  if (control !== undefined) {
    return toHelpRow(control)
  }

  const command = options.commands.find((candidate) => candidate.name === name)

  if (command === undefined) {
    return renderUnknownTopic(i18n, options, name)
  }

  const row = toHelpRow({
    verb: `/${command.name}`,
    description: describeCommand(i18n, command.description),
  })

  return command.usage === undefined
    ? row
    : `${row}\n\n${renderMessages(i18n, { kind: 'message', messages: [command.usage()] })}`
}

function renderUnknownTopic(i18n: LocaleLookup, options: CommandHelpOptions, name: string): string {
  const near = closestName(name, [
    ...options.controls.map((control) => normalizeName(control.verb)),
    ...options.commands.map((command) => command.name),
  ])
  const shown = renderCommandText(name)

  return near === undefined
    ? i18n.translate(UNKNOWN_TOPIC_KEY, { name: shown })
    : i18n.translate(NEAR_TOPIC_KEY, { name: shown, near })
}

function toHelpRow(entry: HelpControl): string {
  return `${entry.verb} - ${entry.description}`
}
