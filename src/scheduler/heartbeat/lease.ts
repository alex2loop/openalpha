import type { AgentProfile } from '@/engine/api'
import type {
  ClaimHeartbeatTaskOutcome,
  HeartbeatDeps,
  HeartbeatTask,
} from '@/scheduler/heartbeat/types'
import { formatErrForLog } from '@/core/security/credentials'
import { computeBackoffMs } from '@/core/utils/retry'
import { RUN_LEASE_SLACK_MS } from '@/engine/api'
import { RETRY_BASE_MS, RETRY_CAP_MS } from '@/scheduler/backoff'

interface ClaimHeartbeatTaskArgs {
  readonly deps: HeartbeatDeps
  readonly agentId: AgentProfile['id']
  readonly task: HeartbeatTask
  readonly operationNow: number
  readonly token: string
}

export async function claimHeartbeatTask(
  args: ClaimHeartbeatTaskArgs
): Promise<ClaimHeartbeatTaskOutcome> {
  const { deps, agentId, task, operationNow, token } = args
  // Tasks run one after another, so the lease is stamped at this claim, not at the batch's
  // due-selection instant: an earlier task may have run for minutes since that was read.
  const claimedAt = Date.now()

  try {
    return await deps.store.claimTask({
      agentId,
      taskName: task.name,
      token,
      now: claimedAt,
      dueBefore: operationNow - task.intervalMs,
      leaseExpiresBefore: claimedAt - (deps.runMaxDurationMs + RUN_LEASE_SLACK_MS),
    })
  } catch (err: unknown) {
    deps.logger.warn('heartbeat.claim_failed', {
      agentId,
      task: task.name,
      err: formatErrForLog(err),
    })

    return { kind: 'not_claimed' }
  }
}

export async function releaseHeartbeatTask(
  deps: HeartbeatDeps,
  input: { readonly agentId: AgentProfile['id']; readonly taskName: string; readonly token: string }
): Promise<void> {
  try {
    await deps.store.releaseTask(input)
  } catch (err: unknown) {
    deps.logger.warn('heartbeat.release_failed', {
      agentId: input.agentId,
      task: input.taskName,
      err: formatErrForLog(err),
    })
  }
}

// A run that never reached 'completed' (errored, halted, or whose completion write failed) leaves
// last_completed_at untouched, so without this the task is immediately due again on the next
// tick -- forever, at whatever cadence the tick runs. Backing off the next eligible claim by the
// same shape jobs use keeps a permanently failing task from hammering the LLM unbounded.
export async function deferFailedHeartbeatTask(input: {
  readonly deps: HeartbeatDeps
  readonly agentId: AgentProfile['id']
  readonly task: HeartbeatTask
  readonly token: string
  readonly consecutiveFailures: number
}): Promise<void> {
  const { deps, agentId, task, token, consecutiveFailures } = input
  const failedAt = Date.now()
  const nextFailures = consecutiveFailures + 1
  const nextRetryAt = failedAt + computeBackoffMs(nextFailures, RETRY_BASE_MS, RETRY_CAP_MS)

  try {
    await deps.store.recordFailure({ agentId, taskName: task.name, token, nextRetryAt })
  } catch (err: unknown) {
    deps.logger.warn('heartbeat.failure_record_failed', {
      agentId,
      task: task.name,
      err: formatErrForLog(err),
    })
  }
}
