import type { ChannelId } from '@/core/channels'
import type { RunId, SessionId } from '@/core/ids'
import type { ProgressMessage } from '@/core/stream-events'
import type { SlashResult } from '@/core/types/command'

declare module '@/core/events' {
  interface BusEventMap {
    command_started: {
      readonly runId: RunId
      readonly name: string
      readonly channel: ChannelId
      readonly chatId: string
      readonly sessionId: SessionId
      readonly startedAt: number
    }
    command_progress: {
      readonly runId: RunId
      readonly channel: ChannelId
      readonly message: ProgressMessage
    }
    command_finished: {
      readonly runId: RunId
      readonly channel: ChannelId
      readonly outcome: 'completed' | 'aborted' | 'error'
      // Present on `completed`; read in-process only and never put on the wire.
      readonly result?: SlashResult
      /** The work found nothing to do, so no activity row keeps the run. */
      readonly idle?: true
    }
  }
}
