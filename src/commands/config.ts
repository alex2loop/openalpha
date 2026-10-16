import type {
  CommandDescription,
  CommandMessage,
  CommandMessageKey,
  SlashCommand,
  SlashInvocationPolicy,
  SlashResult,
} from '@/core/types/command'
import type { Locale } from '@/core/types/locale'

const MESSAGE_KEYS: readonly CommandMessageKey[] = [
  'slash.configTitle',
  'slash.configLocale',
  'slash.configModel',
  'slash.configBudget',
  'slash.configBudgetUncapped',
  'slash.configBudgetDailyOnly',
  'slash.configBudgetMonthlyOnly',
  'slash.configChannels',
  'slash.configNoChannels',
]
const DESCRIPTION: CommandDescription = { kind: 'localized', key: 'slash.configHelp' }
const POLICY = {
  surfaces: ['channel', 'repl'],
  role: 'operator',
  action: 'read',
} as const satisfies SlashInvocationPolicy
const UNCAPPED = 0

/** Not the whole config tree: this reaches a channel, so it carries no paths, keys, or credentials. */
export interface ConfigSummary {
  readonly locale: Locale
  readonly timezone: string
  readonly model: string
  readonly maxDailyUsd: number
  readonly maxMonthlyUsd: number
  readonly channels: readonly string[]
}

export interface ConfigSummaryReader {
  read(): ConfigSummary
}

export function createConfigCommand(reader: ConfigSummaryReader): SlashCommand {
  return {
    name: 'config',
    description: DESCRIPTION,
    messageKeys: [...MESSAGE_KEYS],
    policy: POLICY,
    run: async (): Promise<SlashResult> => ({
      kind: 'message',
      title: { key: 'slash.configTitle' },
      messages: toSummaryLines(reader.read()),
    }),
  }
}

function toSummaryLines(summary: ConfigSummary): readonly CommandMessage[] {
  return [
    {
      key: 'slash.configLocale',
      values: { locale: summary.locale, timezone: summary.timezone },
    },
    { key: 'slash.configModel', values: { model: summary.model } },
    toBudgetLine(summary),
    toChannelLine(summary.channels),
  ]
}

/** 0 means uncapped, not "no spend allowed" — rendering it as `$0` would read as a hard stop. */
function toBudgetLine(summary: ConfigSummary): CommandMessage {
  const daily = summary.maxDailyUsd
  const monthly = summary.maxMonthlyUsd

  if (daily === UNCAPPED && monthly === UNCAPPED) {
    return { key: 'slash.configBudgetUncapped' }
  }

  if (monthly === UNCAPPED) {
    return { key: 'slash.configBudgetDailyOnly', values: { daily } }
  }

  if (daily === UNCAPPED) {
    return { key: 'slash.configBudgetMonthlyOnly', values: { monthly } }
  }

  return {
    key: 'slash.configBudget',
    values: { daily, monthly },
  }
}

function toChannelLine(channels: readonly string[]): CommandMessage {
  if (channels.length === 0) {
    return { key: 'slash.configNoChannels' }
  }

  return { key: 'slash.configChannels', values: { channels: channels.join(', ') } }
}
