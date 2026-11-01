import type { InboundHandlerDeps } from '@/channels/delivery/types'
import type { SessionRouteLease } from '@/core/types/session'
import { toCommandLaneKey } from '@/core/command-lane'
import { RunHalted } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'

interface LaneSlashInput {
  readonly deps: InboundHandlerDeps
  readonly chatId: string
  /** The dispatch's request id: names the entry to the lane. */
  readonly id: string
  readonly route: SessionRouteLease
  readonly task: () => Promise<void>
}

/** Runs a self-contained command in the chat's lane, beside whatever turn the session is on. A
 *  command cancelled while it waits, or whose chat moved to a new session, is a stop the operator
 *  asked for, not a failure: it ends here without a word. A full lane propagates `queue_full`. */
export async function runInCommandLane(input: LaneSlashInput): Promise<void> {
  const { deps, chatId, id, route, task } = input
  const queued = deps.commandLane.enqueue({
    key: toCommandLaneKey(deps.channelId, chatId),
    id,
    registration: route.register(),
    task,
    onWaiting: (position) => announceQueued(deps, chatId, position),
  })

  route.release()

  try {
    await queued
  } catch (err: unknown) {
    if (!(err instanceof RunHalted && err.code === 'abort')) {
      throw err
    }
  }
}

// Not awaited: the lane calls this synchronously, and a slow send must not hold the line.
function announceQueued(deps: InboundHandlerDeps, chatId: string, position: number): void {
  const key = position === 1 ? 'channel.commandQueuedNext' : 'channel.commandQueued'

  deps.sendText(chatId, t(deps.locale, key, { position })).catch((err: unknown) => {
    deps.logger.warn('channel.command_queued_unsent', {
      channel: deps.channelId,
      err: formatErrForLog(err),
    })
  })
}
