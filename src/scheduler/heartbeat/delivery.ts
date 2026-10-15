import { performance } from 'node:perf_hooks'

import type { Logger } from '@/core/logging/logger'
import type { LruMap } from '@/core/utils/collections'
import type { AgentProfile } from '@/engine/api'
import type { HeartbeatTask } from '@/scheduler/heartbeat/types'
import type { DeliverySink, DeliveryTarget } from '@/scheduler/types'
import { parseChannelAddress } from '@/core/channels'
import { formatErrForLog } from '@/core/security/credentials'
import { lruMap } from '@/core/utils/collections'
import { hashString } from '@/core/utils/hash'

const DELIVERY_CACHE_MAX = 200

// Process-local delivery history, bounded by an LRU. Suppression is best-effort across retained
// entries in the current daemon process; restart and eviction forget old entries. Lives inside the
// startHeartbeats lifecycle so concurrent runs never share mutable state.
export interface HeartbeatRuntimeState {
  readonly acceptedAtMonotonicMs: LruMap<string, number>
}

export function createHeartbeatRuntimeState(): HeartbeatRuntimeState {
  return { acceptedAtMonotonicMs: lruMap<string, number>(DELIVERY_CACHE_MAX) }
}

interface DeliverOptions {
  readonly agentId: AgentProfile['id']
  readonly task: HeartbeatTask
  readonly text: string
  readonly logger: Logger
  readonly notifier: DeliverySink
  readonly state: HeartbeatRuntimeState
}

export async function deliverHeartbeatResult(options: DeliverOptions): Promise<void> {
  const { agentId, task, text, logger, notifier, state } = options

  if (task.deliver === undefined) {
    return
  }

  const trimmed = text.trim()
  const fingerprint = hashString(trimmed)

  for (const rawTarget of task.deliver) {
    const target = parseHeartbeatTarget(rawTarget, task.name, logger)

    if (target === undefined) {
      continue
    }

    await deliverToOne({
      agentId,
      taskName: task.name,
      target,
      text,
      fingerprint,
      logger,
      notifier,
      state,
      duplicateWindowMs: task.duplicateWindowMs,
    })
  }
}

async function deliverToOne(options: {
  readonly agentId: string
  readonly taskName: string
  readonly target: DeliveryTarget
  readonly text: string
  readonly fingerprint: string
  readonly logger: Logger
  readonly notifier: DeliverySink
  readonly state: HeartbeatRuntimeState
  readonly duplicateWindowMs: number | undefined
}): Promise<void> {
  const {
    agentId,
    taskName,
    target,
    text,
    fingerprint,
    logger,
    notifier,
    state,
    duplicateWindowMs,
  } = options
  const key = toNotificationCacheKey({ agentId, taskName, target, fingerprint })

  if (isDuplicateNotification(state, key, duplicateWindowMs)) {
    logger.debug('heartbeat.duplicate_skipped', { agentId, task: taskName })
    return
  }

  try {
    await notifier.notify(target, text)
  } catch (err: unknown) {
    // A rejected send is never cached: the next eligible run may retry it.
    logger.warn('heartbeat.delivery_failed', {
      task: taskName,
      target: `${target.channel}:${target.chatId}`,
      err: formatErrForLog(err),
    })
    return
  }

  // Cache only when the notifier accepted (sent or admitted to its bounded queue), and only for
  // tasks that asked for suppression. Tasks without a window must not consume LRU capacity.
  if (duplicateWindowMs !== undefined) {
    state.acceptedAtMonotonicMs.set(key, performance.now())
  }
}

interface NotificationCacheKeyInput {
  readonly agentId: string
  readonly taskName: string
  readonly target: DeliveryTarget
  readonly fingerprint: string
}

function toNotificationCacheKey(input: NotificationCacheKeyInput): string {
  return [
    input.agentId,
    input.taskName,
    input.target.channel,
    input.target.chatId,
    input.fingerprint,
  ].join('\u0000')
}

// Elapsed process time, never the adjustable wall clock: clock steps must not change suppression.
function isDuplicateNotification(
  state: HeartbeatRuntimeState,
  key: string,
  duplicateWindowMs: number | undefined
): boolean {
  if (duplicateWindowMs === undefined) {
    return false
  }

  const lastAcceptedAtMonotonicMs = state.acceptedAtMonotonicMs.get(key)

  return (
    lastAcceptedAtMonotonicMs !== undefined &&
    performance.now() - lastAcceptedAtMonotonicMs < duplicateWindowMs
  )
}

function parseHeartbeatTarget(
  rawTarget: string,
  taskName: string,
  logger: Logger
): DeliveryTarget | undefined {
  try {
    return parseChannelAddress(rawTarget)
  } catch (err: unknown) {
    logger.warn('heartbeat.delivery_target_invalid', {
      task: taskName,
      target: rawTarget,
      err: formatErrForLog(err),
    })

    return undefined
  }
}
