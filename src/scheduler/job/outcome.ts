import type { RunResult } from '@/engine/api'
import type {
  Job,
  SchedulerDeps,
  SchedulerJobTransition,
  SchedulerRunOutcome,
} from '@/scheduler/types'
import { RunHalted } from '@/core/errors'
import { advanceCron } from '@/core/utils/cron'
import { computeBackoffMs } from '@/core/utils/retry'
import { isSpendCapHalt, PAUSED_MESSAGE } from '@/engine/api'
import { RETRY_BASE_MS, RETRY_CAP_MS } from '@/scheduler/backoff'

export const CRON_AUTO_DISABLE_THRESHOLD = 3
export const SHUTDOWN_MESSAGE = 'aborted (shutdown)'

// The history row keeps the head of the answer, not the answer: `history` is for "did it run and
// what came out", and a full brief would bloat the table.
const SUMMARY_MAX_CHARS = 500
const APPROVAL_DENIED_MESSAGE = 'halted (approval denied or timed out)'
const SPEND_CAP_MESSAGE = 'halted (spend cap reached)'
const RATE_LIMITED_MESSAGE = 'halted (rate limited)'
// Halts that advance the schedule without counting a failure: the job itself is not broken.
export const UNCOUNTED_HALT_MESSAGES: ReadonlySet<string> = new Set([
  SHUTDOWN_MESSAGE,
  APPROVAL_DENIED_MESSAGE,
  SPEND_CAP_MESSAGE,
  PAUSED_MESSAGE,
])

// A stop, target or mover job waits for the next crossing and stays on. A price job is spent by the
// one crossing its alert had, so it takes the same path as any other one-shot and is disabled.
function isParkedEventJob(job: Job): boolean {
  return job.event !== undefined && job.event.event !== 'price'
}

export function isAbortHalt(err: unknown): boolean {
  return err instanceof RunHalted && err.code === 'abort'
}

export function computeOutcome(
  result: RunResult,
  denied: boolean,
  now: number
): SchedulerRunOutcome {
  // Only an approval timeout leaves the job itself healthy; every other code is a real failure.
  if (result.completionCode !== undefined) {
    return {
      status: 'failed',
      endedAtMs: now,
      errorMessage:
        result.completionCode === 'approval_timeout'
          ? APPROVAL_DENIED_MESSAGE
          : result.completionCode,
    }
  }

  if (result.reason === 'completed') {
    return {
      status: 'success',
      endedAtMs: now,
      summary: result.text.slice(0, SUMMARY_MAX_CHARS),
      costUsd: result.runCostUsd ?? 0,
    }
  }

  if (result.reason === 'aborted') {
    return { status: 'failed', endedAtMs: now, errorMessage: SHUTDOWN_MESSAGE }
  }

  if (denied) {
    return { status: 'failed', endedAtMs: now, errorMessage: APPROVAL_DENIED_MESSAGE }
  }

  if (isSpendCapHalt(result)) {
    return { status: 'failed', endedAtMs: now, errorMessage: SPEND_CAP_MESSAGE }
  }

  if (result.haltCode === 'rate') {
    return { status: 'failed', endedAtMs: now, errorMessage: RATE_LIMITED_MESSAGE }
  }

  return {
    status: 'failed',
    endedAtMs: now,
    errorMessage: result.errorMessage ?? result.reason,
    ...(result.missingEnv === undefined ? {} : { missingEnv: result.missingEnv }),
  }
}

export function computeTransition(
  job: Job,
  outcome: SchedulerRunOutcome,
  now: number
): SchedulerJobTransition {
  if (outcome.status === 'success') {
    return nextTransition(job, now)
  }

  if (outcome.missingEnv !== undefined) {
    return keylessTransition(job, now)
  }

  if (UNCOUNTED_HALT_MESSAGES.has(outcome.errorMessage)) {
    return haltTransition(job, outcome.errorMessage, now)
  }

  // The limiter clears within its window, so the occurrence is kept and asked again later.
  if (outcome.errorMessage === RATE_LIMITED_MESSAGE) {
    return deferredTransition(job, now)
  }

  const failures = job.consecutiveFailures + 1

  if (failures >= CRON_AUTO_DISABLE_THRESHOLD) {
    return { kind: 'disable' }
  }

  const delay = computeBackoffMs(failures, RETRY_BASE_MS, RETRY_CAP_MS)
  return { kind: 'retry', failures, nextRunAt: retryAt(job, now + delay) }
}

// An event job has no time to come back at: a retry keeps it parked, so only its alert wakes it.
function retryAt(job: Job, at: number): number {
  return job.event !== undefined && job.schedule.kind === 'once' ? job.schedule.at : at
}

// A key arrives with a restart, never by waiting, so the job keeps its place and no failure is
// counted. A once job has no later occurrence, so it stays due and is asked again after the cap.
function keylessTransition(job: Job, now: number): SchedulerJobTransition {
  if (job.schedule.kind === 'once') {
    return deferredTransition(job, now)
  }

  return { kind: 'skip', nextRunAt: nextScheduledRunAt(job, now) }
}

// A paused or capped agent's one-shot is deferred without a failure counted, so it runs once the
// agent is resumed or the day rolls over instead of being disabled for a halt that is not the job's.
function onceHaltTransition(job: Job, message: string, now: number): SchedulerJobTransition {
  if (job.event !== undefined) {
    return nextTransition(job, now)
  }

  if (message === PAUSED_MESSAGE || message === SPEND_CAP_MESSAGE) {
    return deferredTransition(job, now)
  }

  return message === SHUTDOWN_MESSAGE ? { kind: 'skip', nextRunAt: now } : { kind: 'disable' }
}

// Asked again after the longest backoff with no failure counted.
function deferredTransition(job: Job, now: number): SchedulerJobTransition {
  return {
    kind: 'retry',
    failures: job.consecutiveFailures,
    nextRunAt: retryAt(job, now + RETRY_CAP_MS),
  }
}

function haltTransition(job: Job, message: string, now: number): SchedulerJobTransition {
  // A once job has no later occurrence to carry on with. A run cut short by shutdown never
  // finished, so the job stays due and the next start runs it; a denied or timed-out approval is
  // the operator's answer, and asking again every tick would only repeat the question.
  if (job.schedule.kind === 'once') {
    return onceHaltTransition(job, message, now)
  }

  const transition = nextTransition(job, now)

  return transition.kind === 'advance'
    ? { kind: 'skip', nextRunAt: transition.nextRunAt }
    : transition
}

export async function advanceJob(job: Job, deps: SchedulerDeps, now: number): Promise<void> {
  const transition = nextTransition(job, now)

  if (transition.kind === 'disable') {
    await deps.jobStore.disable(job.id)
    return
  }

  await deps.jobStore.advance(job.id, transition.nextRunAt)
}

function nextTransition(job: Job, now: number): SchedulerJobTransition {
  if (job.schedule.kind === 'once') {
    return isParkedEventJob(job)
      ? { kind: 'advance', nextRunAt: job.schedule.at }
      : { kind: 'disable' }
  }

  return { kind: 'advance', nextRunAt: nextScheduledRunAt(job, now) }
}

function nextScheduledRunAt(job: Job, now: number): number {
  if (job.schedule.kind === 'cron') {
    return advanceCron(job.schedule.expr, new Date(now), job.schedule.timezone).getTime()
  }

  if (job.schedule.kind === 'interval') {
    return now + job.schedule.everyMs
  }

  return job.schedule.at
}
