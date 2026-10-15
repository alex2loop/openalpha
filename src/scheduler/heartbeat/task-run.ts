import type { Logger } from '@/core/logging/logger'
import type { AgentProfile, RunOnceOptions, RunResult } from '@/engine/api'
import type { HeartbeatRuntimeState } from '@/scheduler/heartbeat/delivery'
import type {
  HeartbeatCommitment,
  HeartbeatDeps,
  HeartbeatSessionMode,
  HeartbeatTask,
  HeartbeatTaskRun,
} from '@/scheduler/heartbeat/types'
import { formatErrForLog } from '@/core/security/credentials'
import { renderCommitments } from '@/scheduler/heartbeat/commitments'
import { HEARTBEAT_RESPONSE_INSTRUCTION } from '@/scheduler/heartbeat/response'

const DEFAULT_HEARTBEAT_SESSION_MODE: HeartbeatSessionMode = 'shared'

export interface RunHeartbeatTaskInput {
  readonly agent: AgentProfile
  readonly deps: HeartbeatDeps
  readonly signal: AbortSignal
  readonly state: HeartbeatRuntimeState
  readonly context: string
  readonly task: HeartbeatTask
  readonly operationNow: number
}

/** `undefined` when the extra tasks could not be read: the caller skips the tick rather than sync
 *  without them, which would delete their completion rows and run every one at once next tick. */
export async function extraTasksOf(
  deps: HeartbeatDeps,
  agent: AgentProfile
): Promise<readonly HeartbeatTask[] | undefined> {
  if (deps.extraTasks === undefined) {
    return []
  }

  try {
    return await deps.extraTasks(agent)
  } catch (err: unknown) {
    deps.logger.warn('heartbeat.extra_tasks_failed', {
      agentId: agent.id,
      err: formatErrForLog(err),
    })

    return undefined
  }
}

/** An operator task already holds a name: the file wins, and the added task waits for a rename. */
export function withoutTakenNames(
  own: readonly HeartbeatTask[],
  extra: readonly HeartbeatTask[],
  logger: Logger
): readonly HeartbeatTask[] {
  const taken = new Set(own.map((task) => task.name))

  return extra.filter((task) => {
    if (!taken.has(task.name)) {
      return true
    }

    logger.warn('heartbeat.task_name_taken', { task: task.name })

    return false
  })
}

export function runTaskAgent(
  input: RunHeartbeatTaskInput,
  commitments: readonly HeartbeatCommitment[]
): Promise<RunResult> {
  const { agent, deps, signal, context, task } = input
  const session = task.session ?? DEFAULT_HEARTBEAT_SESSION_MODE
  // A task the runtime adds never sees the operator's own HEARTBEAT.md notes: a social visit reads
  // strangers' posts, and those notes may describe the book.
  const prompt = toHeartbeatPrompt(task.run === undefined ? context : '', task.prompt, commitments)

  return deps.runner.run(
    deps.runInput({
      agent,
      prompt,
      session,
      ...(task.run === undefined ? {} : { channel: task.run.channel }),
    }),
    // Passing the same value the lease is computed from ties the run's actual cap to the lease
    // deterministically -- the two cannot drift apart from separately-wired config reads.
    toHeartbeatRunOptions({ signal, session, maxDurationMs: deps.runMaxDurationMs, run: task.run })
  )
}

function toHeartbeatPrompt(
  context: string,
  taskPrompt: string,
  commitments: readonly HeartbeatCommitment[]
): string {
  const trimmedContext = context.trim()
  const parts = trimmedContext === '' ? [taskPrompt] : [trimmedContext, taskPrompt]

  if (commitments.length > 0) {
    parts.push(renderCommitments(commitments))
  }

  parts.push(HEARTBEAT_RESPONSE_INSTRUCTION)

  return parts.join('\n\n')
}

function toHeartbeatRunOptions(options: {
  readonly signal: AbortSignal
  readonly session: HeartbeatSessionMode
  readonly maxDurationMs: number
  readonly run: HeartbeatTaskRun | undefined
}): RunOnceOptions {
  const { signal, session, run } = options
  const common: RunOnceOptions = {
    approvalMode: 'unavailable',
    parentSignal: signal,
    // The lease is sized from the outer value, so a task may only shorten it.
    maxDurationMs: Math.min(options.maxDurationMs, run?.maxDurationMs ?? options.maxDurationMs),
    ...(run === undefined ? {} : { allowedTools: run.allowedTools, maxTurns: run.maxTurns }),
  }

  return session === 'isolated'
    ? { ...common, persistence: 'ephemeral', billingSessionId: null }
    : { ...common, persistence: 'enabled' }
}
