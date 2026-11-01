import type { ChannelId } from '@/core/channels'
import type {
  CommandMessage,
  CommandMessageKey,
  SlashCommand,
  SlashResult,
} from '@/core/types/command'
import { BRAND } from '@/core/brand'

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
  'slash.healthJobsWorking',
  'slash.healthJobsIdle',
  'slash.healthJobsFailing',
]

export interface ChannelHealth {
  readonly channel: ChannelId
  readonly code: HealthCode
}

/** The daemon's automatic jobs by label: those in a pass now, and those whose last pass failed. */
export interface JobsHealth {
  readonly working: readonly string[]
  readonly failing: readonly string[]
}

export interface HealthSummary {
  readonly runtime: HealthCode
  /** Every configured channel, whether or not a runtime for it came up. */
  readonly channels: readonly ChannelHealth[]
  /** Absent where this process runs no automatic jobs, as `openalpha chat` without a daemon. */
  readonly jobs?: JobsHealth
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
        messages: [
          { key: RUNTIME_KEYS[summary.runtime] },
          ...toChannelLines(summary.channels),
          ...(summary.jobs === undefined ? [] : toJobLines(summary.jobs)),
        ],
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

// Labels only: any paired member may ask, and a failure's sentence can name a host or a variable.
function toJobLines(jobs: JobsHealth): readonly CommandMessage[] {
  const lines: CommandMessage[] = [
    jobs.working.length === 0
      ? { key: 'slash.healthJobsIdle' }
      : { key: 'slash.healthJobsWorking', values: { jobs: jobs.working.join(', ') } },
  ]

  if (jobs.failing.length > 0) {
    lines.push({
      key: 'slash.healthJobsFailing',
      values: { jobs: jobs.failing.join(', '), brand: BRAND.name },
    })
  }

  return lines
}
