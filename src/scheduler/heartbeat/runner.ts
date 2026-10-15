import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type { AgentId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { AgentProfile } from '@/engine/api'
import type {
  ClaimHeartbeatTaskOutcome,
  HeartbeatDeps,
  HeartbeatTask,
} from '@/scheduler/heartbeat/types'
import { formatErrForLog } from '@/core/security/credentials'
import { sanitizeDisplayText, toFencedText } from '@/core/utils/text'
import { isWithinDailyWindow } from '@/core/utils/time'
import { AGENT_CAP_MESSAGE, PAUSED_MESSAGE, RUN_LEASE_SLACK_MS } from '@/engine/api'
import { computeBackoffMs, RETRY_BASE_MS, RETRY_CAP_MS } from '@/scheduler/backoff'
import {
  completeHeartbeatTask,
  loadDueCommitments,
  logTaskCompletion,
} from '@/scheduler/heartbeat/commitments'
import {
  createHeartbeatRuntimeState,
  deliverHeartbeatResult,
  type HeartbeatRuntimeState,
} from '@/scheduler/heartbeat/delivery'
import { loadHeartbeatFile } from '@/scheduler/heartbeat/file'
import { parseHeartbeat } from '@/scheduler/heartbeat/parse'
import {
  type HeartbeatResponse,
  parseHeartbeatResponse,
  SILENT_HEARTBEAT_RESPONSE,
  toHeartbeatTaskOutcome,
} from '@/scheduler/heartbeat/response'
import {
  extraTasksOf,
  type RunHeartbeatTaskInput,
  runTaskAgent,
  withoutTakenNames,
} from '@/scheduler/heartbeat/task-run'

const HEARTBEAT_TICK_MS = 30_000
const HEARTBEAT_MAX_CONCURRENT = 3
const HEARTBEAT_FILE = 'HEARTBEAT.md'
const UNTRUSTED_NOTICE_CHARS = 500
const NO_HEARTBEAT_FILE = Object.freeze({ context: '', tasks: [], dropped: 0 })

export function startHeartbeats(
  deps: HeartbeatDeps,
  agents: readonly AgentProfile[],
  signal: AbortSignal
): () => Promise<void> {
  const state = createHeartbeatRuntimeState()
  let stopped = false
  let activeTick: Promise<void> | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const tick = (): void => {
    if (stopped || signal.aborted || activeTick !== null) {
      return
    }

    activeTick = tickHeartbeats({ deps, agents, signal, state })
      .catch((err: unknown) => {
        deps.logger.warn('heartbeat.failed', { err: formatErrForLog(err) })
      })
      .finally(() => {
        activeTick = null
      })
  }

  const halt = (): void => {
    if (stopped) {
      return
    }

    stopped = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    signal.removeEventListener('abort', halt)
  }
  // Awaits the in-flight tick so storage cannot close under its claim/complete/release calls.
  const dispose = async (): Promise<void> => {
    halt()
    await activeTick
  }

  if (signal.aborted) {
    return dispose
  }

  timer = setInterval(tick, HEARTBEAT_TICK_MS)
  // Never the reason the process stays up: `halt` clears it, but a missed teardown must not
  // wedge shutdown.
  timer.unref()
  signal.addEventListener('abort', halt, { once: true })

  return dispose
}

async function tickHeartbeats(options: {
  readonly deps: HeartbeatDeps
  readonly agents: readonly AgentProfile[]
  readonly signal: AbortSignal
  readonly state: HeartbeatRuntimeState
}): Promise<void> {
  const { deps, signal, state } = options
  const paused = await pausedAgents(deps)

  // A pause that cannot be read is a pause: the tick waits rather than wake an agent the operator
  // may have switched off. One that lands after this read costs one counted failure, which is fine.
  if (paused === undefined) {
    return
  }

  const agents = options.agents.filter((agent) => !paused.has(agent.id))

  for (let index = 0; index < agents.length; index += HEARTBEAT_MAX_CONCURRENT) {
    if (signal.aborted) {
      return
    }

    const batch = agents.slice(index, index + HEARTBEAT_MAX_CONCURRENT)
    const results = await Promise.allSettled(
      batch.map((agent) => runHeartbeatAgent({ agent, deps, signal, state }))
    )

    logAgentFailures(batch, results, deps.logger)
  }
}

async function pausedAgents(deps: HeartbeatDeps): Promise<ReadonlySet<AgentId> | undefined> {
  if (deps.pauses === undefined) {
    return new Set()
  }

  try {
    return await deps.pauses.list()
  } catch (err: unknown) {
    deps.logger.warn('heartbeat.pause_read_failed', { err: formatErrForLog(err) })

    return undefined
  }
}

function logAgentFailures(
  batch: readonly AgentProfile[],
  results: readonly PromiseSettledResult<void>[],
  logger: Logger
): void {
  for (let i = 0; i < batch.length; i++) {
    const result = results[i]
    const agent = batch[i]

    if (result === undefined || agent === undefined || result.status !== 'rejected') {
      continue
    }

    logger.warn('heartbeat.agent_failed', {
      agentId: agent.id,
      err: formatErrForLog(result.reason),
    })
  }
}

interface RunHeartbeatAgentInput {
  readonly agent: AgentProfile
  readonly deps: HeartbeatDeps
  readonly signal: AbortSignal
  readonly state: HeartbeatRuntimeState
}

/** A task the runtime adds reads strangers' text, so what it says to the operator is bounded, has
 *  no control characters, and sits in a code block: a link a network talked it into is not a tap. */
function toUntrustedNotice(text: string): string {
  return toFencedText(sanitizeDisplayText(text).slice(0, UNTRUSTED_NOTICE_CHARS))
}

async function runHeartbeatAgent(input: RunHeartbeatAgentInput): Promise<void> {
  const { agent, deps, signal, state } = input
  const loaded = await loadHeartbeatFile(
    join(deps.workspaceDir(agent), HEARTBEAT_FILE),
    deps.logger
  )
  const parsed = loaded.kind === 'loaded' ? parseHeartbeat(loaded.text) : NO_HEARTBEAT_FILE
  const extra = await extraTasksOf(deps, agent)

  if (extra === undefined || signal.aborted) {
    return
  }

  const tasks = [...parsed.tasks, ...withoutTakenNames(parsed.tasks, extra, deps.logger)]

  // Only a file that was read can say which tasks are gone; a missing or unreadable one keeps its
  // rows, as it always has.
  if (loaded.kind === 'loaded') {
    await deps.store.syncTasks(
      agent.id,
      tasks.map((task) => task.name)
    )
  }

  if (tasks.length === 0) {
    return
  }

  if (parsed.dropped > 0) {
    deps.logger.warn('heartbeat.tasks_dropped', { agentId: agent.id, dropped: parsed.dropped })
  }

  await runTasksInOrder({ agent, deps, signal, state, context: parsed.context, tasks })
}

async function runTasksInOrder(input: {
  readonly agent: AgentProfile
  readonly deps: HeartbeatDeps
  readonly signal: AbortSignal
  readonly state: HeartbeatRuntimeState
  readonly context: string
  readonly tasks: readonly HeartbeatTask[]
}): Promise<void> {
  const { agent, deps, signal, state, context, tasks } = input
  // One clock read for the whole due-selection operation so every task sees the same instant.
  const operationNow = Date.now()

  for (const task of tasks) {
    if (signal.aborted) {
      return
    }

    await runHeartbeatTask({ agent, deps, signal, state, context, task, operationNow })
  }
}

// The lease is the due check: nothing before it decides whether this instance owns the task, and
// the release in `finally` is a no-op once completion has cleared the token.
async function runHeartbeatTask(input: RunHeartbeatTaskInput): Promise<void> {
  const { agent, deps, task, operationNow } = input

  if (task.activeHours !== undefined && !isWithinDailyWindow(operationNow, task.activeHours)) {
    return
  }

  const token = randomUUID()
  const claim = await claimHeartbeatTask({ deps, agentId: agent.id, task, operationNow, token })

  if (claim.kind !== 'claimed') {
    return
  }

  try {
    await runClaimedHeartbeatTask(input, token, claim.consecutiveFailures)
  } finally {
    await releaseHeartbeatTask(deps, { agentId: agent.id, taskName: task.name, token })
  }
}

interface ClaimHeartbeatTaskArgs {
  readonly deps: HeartbeatDeps
  readonly agentId: AgentProfile['id']
  readonly task: HeartbeatTask
  readonly operationNow: number
  readonly token: string
}

async function claimHeartbeatTask(
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

async function releaseHeartbeatTask(
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

async function runClaimedHeartbeatTask(
  input: RunHeartbeatTaskInput,
  token: string,
  consecutiveFailures: number
): Promise<void> {
  const { agent, deps, task, operationNow } = input
  const commitments =
    task.keepsCommitments === false
      ? []
      : await loadDueCommitments({
          store: deps.store,
          logger: deps.logger,
          agentId: agent.id,
          taskName: task.name,
          now: operationNow,
        })
  const result = await runTaskAgent(input, commitments)

  // A capped or paused agent is not a failing task: the lease is released and the task is due again
  // once the cap resets or the agent is resumed, with no failure counted against it. A run cut short
  // by shutdown never finished, so it is treated the same way (scheduled jobs do the same).
  if (
    result.reason === 'aborted' ||
    result.errorMessage === AGENT_CAP_MESSAGE ||
    result.errorMessage === PAUSED_MESSAGE
  ) {
    return
  }

  const endedAtOwnTurnCap = task.run !== undefined && result.haltCode === 'turn_limit'

  if (result.reason !== 'completed' && !endedAtOwnTurnCap) {
    await deferFailedHeartbeatTask({ deps, agentId: agent.id, task, token, consecutiveFailures })
    return
  }

  const response = endedAtOwnTurnCap
    ? SILENT_HEARTBEAT_RESPONSE
    : parseHeartbeatResponse(result.text)

  await settleCompletedHeartbeatTask(input, { token, response, commitments })
}

interface CompletedHeartbeatRun {
  readonly token: string
  readonly response: HeartbeatResponse
  readonly commitments: Awaited<ReturnType<typeof loadDueCommitments>>
}

async function settleCompletedHeartbeatTask(
  input: RunHeartbeatTaskInput,
  run: CompletedHeartbeatRun
): Promise<void> {
  const { agent, deps, state, task } = input
  const { token, commitments, response } = run
  const drafted = toHeartbeatTaskOutcome(
    response,
    commitments.map((commitment) => commitment.id)
  )
  const outcome =
    task.keepsCommitments === false ? { ...drafted, newCommitmentInputs: [] } : drafted

  if (response.kind === 'invalid') {
    deps.logger.warn('heartbeat.response_invalid', {
      agentId: agent.id,
      task: task.name,
      code: response.code,
    })
  }

  const completion = await completeHeartbeatTask({
    deps,
    agentId: agent.id,
    taskName: task.name,
    token,
    // Deliberately a second clock read: commitments are due relative to when this task actually
    // finished, which an agent run can put minutes after the batch's due-selection instant.
    completedAt: Date.now(),
    outcome,
  })

  if (completion.kind !== 'completed') {
    return
  }

  logTaskCompletion({
    logger: deps.logger,
    agentId: agent.id,
    taskName: task.name,
    responseKind: response.kind,
    inserted: completion.inserted,
    requested: outcome.newCommitmentInputs.length,
  })

  if (outcome.notificationText !== undefined) {
    await deliverHeartbeatResult({
      agentId: agent.id,
      task,
      text:
        task.run === undefined
          ? outcome.notificationText
          : toUntrustedNotice(outcome.notificationText),
      logger: deps.logger,
      notifier: deps.notifier,
      state,
    })
  }
}

// A run that never reached 'completed' (aborted, errored, or otherwise halted) leaves
// last_completed_at untouched, so without this the task is immediately due again on the next
// tick -- forever, at whatever cadence the tick runs. Backing off the next eligible claim by the
// same shape jobs use keeps a permanently failing task from hammering the LLM unbounded.
async function deferFailedHeartbeatTask(input: {
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
