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
  'slash.configLocale',
  'slash.configModel',
  'slash.configBudget',
  'slash.configBudgetUncapped',
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
  if (summary.maxDailyUsd === UNCAPPED && summary.maxMonthlyUsd === UNCAPPED) {
    return { key: 'slash.configBudgetUncapped' }
  }

  return {
    key: 'slash.configBudget',
    values: { daily: summary.maxDailyUsd, monthly: summary.maxMonthlyUsd },
  }
}

function toChannelLine(channels: readonly string[]): CommandMessage {
  if (channels.length === 0) {
    return { key: 'slash.configNoChannels' }
  }

  return { key: 'slash.configChannels', values: { channels: channels.join(', ') } }
}
