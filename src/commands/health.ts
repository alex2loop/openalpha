import type { ChannelId } from '@/core/channels'
import type {
  CommandMessage,
  CommandMessageKey,
  SlashCommand,
  SlashResult,
} from '@/core/types/command'

const SURFACES = ['channel', 'repl'] as const

/** `unknown` means this process runs no channel runtimes, so it cannot observe liveness. */
export type HealthCode = 'ok' | 'degraded' | 'down' | 'unknown'

const RUNTIME_KEYS = {
  ok: 'slash.healthRuntimeOk',
  degraded: 'slash.healthRuntimeDegraded',
  down: 'slash.healthRuntimeDown',
  unknown: 'slash.healthRuntimeUnknown',
} as const satisfies Record<HealthCode, CommandMessageKey>
const CHANNEL_KEYS = {
  ok: 'slash.healthChannelOk',
  degraded: 'slash.healthChannelDegraded',
  down: 'slash.healthChannelDown',
  unknown: 'slash.healthChannelUnknown',
} as const satisfies Record<HealthCode, CommandMessageKey>
const MESSAGE_KEYS: readonly CommandMessageKey[] = [
  ...Object.values(RUNTIME_KEYS),
  ...Object.values(CHANNEL_KEYS),
  'slash.healthNoChannels',
  'slash.healthTitle',
]

export interface ChannelHealth {
  readonly channel: ChannelId
  readonly code: HealthCode
}

export interface HealthSummary {
  readonly runtime: HealthCode
  /** Every configured channel, whether or not a runtime for it came up. */
  readonly channels: readonly ChannelHealth[]
}

export interface HealthSummaryReader {
  read(): Promise<HealthSummary>
}

export function createHealthCommand(reader: HealthSummaryReader): SlashCommand {
  return {
    name: 'health',
    description: { kind: 'localized', key: 'slash.healthHelp' },
    messageKeys: [...MESSAGE_KEYS],
    policy: { surfaces: [...SURFACES], role: 'member', action: 'read' },
    run: async (): Promise<SlashResult> => {
      const summary = await reader.read()

      return {
        kind: 'message',
        title: { key: 'slash.healthTitle' },
        messages: [{ key: RUNTIME_KEYS[summary.runtime] }, ...toChannelLines(summary.channels)],
      }
    },
  }
}

function toChannelLines(channels: readonly ChannelHealth[]): readonly CommandMessage[] {
  if (channels.length === 0) {
    return [{ key: 'slash.healthNoChannels' }]
  }

  return channels.map((item) => ({
    key: CHANNEL_KEYS[item.code],
    values: { channel: item.channel },
  }))
}
