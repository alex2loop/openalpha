import type { JobId } from '@/core/ids'
import type { Job, SchedulerDeps } from '@/scheduler/types'
import { reportPass } from '@/core/container'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_SECOND } from '@/core/utils/time'
import { JOB_MAX_DURATION_MS, runScheduledOccurrence } from '@/scheduler/job/execution'

export const SCHEDULER_STOP_TIMEOUT_MS = 5_000
// A live run-now claim's wall clock is the job's own duration cap plus however long it waited on
// an approval prompt (a cost the duration cap excludes), plus headroom for the claim/execute gap.
const RUN_NOW_CLAIM_TTL_SLACK_MS = 60_000

type SchedulerAdmission<T> =
  | { readonly kind: 'accepted'; readonly completion: Promise<T> }
  | { readonly kind: 'rejected'; readonly reason: 'busy' | 'capacity' | 'stopped' }

// Admission owns concurrency and cancellation only. Whether a run belongs to a scheduled
// occurrence is the executor's business — a manual run must not claim one.
export interface SchedulerController {
  admit<T>(job: Job, execute: (signal: AbortSignal) => Promise<T>): SchedulerAdmission<T>
  cancel(jobId: JobId): Promise<boolean>
  /** Takes `remove` over when the job has a run in flight: it runs once that run has finished and
   *  delivered, so a job removing itself does not delete the row its run still has to finalize
   *  against. False when nothing is in flight (the caller removes now). */
  removeAfterRun(jobId: JobId, remove: () => Promise<void>): boolean
  stop(timeoutMs: number): Promise<void>
}

interface AdmittedJob {
  readonly jobId: JobId
  readonly controller: AbortController
  readonly completion: Promise<void>
}

interface SchedulerState {
  readonly inFlight: Map<JobId, AdmittedJob>
  /** At most one per job in flight; taken out when that run settles. */
  readonly deferredRemovals: Map<JobId, () => Promise<void>>
  readonly signal: AbortSignal
  timer: ReturnType<typeof setTimeout> | null
  tickTask: Promise<void> | null
  stopTask: Promise<void> | null
  onAbort: (() => void) | null
  stopped: boolean
}

interface SchedulerWaitOptions {
  readonly pending: readonly Promise<void>[]
  readonly timeoutMs: number
  readonly state: SchedulerState
  readonly deps: SchedulerDeps
}

interface AdmitJobOptions<T> {
  readonly state: SchedulerState
  readonly job: Job
  readonly deps: SchedulerDeps
  readonly execute: (signal: AbortSignal) => Promise<T>
}

export function startScheduler(deps: SchedulerDeps, signal: AbortSignal): SchedulerController {
  const state = createSchedulerState(signal)
  const controller = createSchedulerController(state, deps)

  if (signal.aborted) {
    state.stopped = true

    return controller
  }

  armSchedulerAbort(state, deps)
  // The first tick waits for the boot sweep: an unmarked stale occurrence or an uncleared run-now
  // claim makes `due()` skip a job that is actually ready.
  recoverAfterBoot(deps).finally(() => scheduleNextTick(state, deps, controller))

  return controller
}

function createSchedulerController(
  state: SchedulerState,
  deps: SchedulerDeps
): SchedulerController {
  return {
    admit: (job, execute) => admitJob({ state, job, deps, execute }),
    cancel: (jobId) => cancelJob(state, jobId),
    removeAfterRun: (jobId, remove) => deferRemoval(state, jobId, remove),
    stop: (timeoutMs) => stopScheduler(state, deps, timeoutMs),
  }
}

function createSchedulerState(signal: AbortSignal): SchedulerState {
  return {
    inFlight: new Map(),
    deferredRemovals: new Map(),
    signal,
    timer: null,
    tickTask: null,
    stopTask: null,
    onAbort: null,
    stopped: false,
  }
}

function armSchedulerAbort(state: SchedulerState, deps: SchedulerDeps): void {
  state.onAbort = () => {
    stopScheduler(state, deps, SCHEDULER_STOP_TIMEOUT_MS).catch((err: unknown) => {
      deps.logger.warn('scheduler.abort_cleanup_failed', { err: formatErrForLog(err) })
    })
  }
  state.signal.addEventListener('abort', state.onAbort, { once: true })
}

function scheduleNextTick(
  state: SchedulerState,
  deps: SchedulerDeps,
  controller: SchedulerController
): void {
  if (state.stopped || state.signal.aborted) {
    return
  }

  const tickMs = deps.config.schedule.tickSeconds * MS_PER_SECOND

  state.timer = setTimeout(() => {
    state.timer = null
    const pass = { name: 'scheduler', everyMs: tickMs, chained: true }
    const task = reportPass(deps.onTaskPass, pass, () => runTick(state, deps, controller))
      .catch((err: unknown) => {
        deps.logger.warn('scheduler.tick_failed', { err: formatErrForLog(err) })
      })
      .finally(() => {
        state.tickTask = null
        scheduleNextTick(state, deps, controller)
      })
    state.tickTask = task
  }, tickMs)
}

async function runTick(
  state: SchedulerState,
  deps: SchedulerDeps,
  controller: SchedulerController
): Promise<void> {
  if (state.stopped || state.signal.aborted) {
    return
  }

  const now = Date.now()
  const runNowClaimTtlMs =
    deps.config.schedule.approvalTimeoutMs + JOB_MAX_DURATION_MS + RUN_NOW_CLAIM_TTL_SLACK_MS
  // A running job stays due until it finalizes: widen the window by the in-flight count so those
  // rows cannot crowd later-due jobs out of the per-tick budget.
  const limit = deps.config.schedule.maxPerTick + state.inFlight.size
  const due = await deps.jobStore.due(now, limit, now - runNowClaimTtlMs)

  if (state.stopped || state.signal.aborted) {
    return
  }

  for (const job of due) {
    const admission = controller.admit(job, (runSignal) =>
      runScheduledOccurrence({ job, deps, signal: runSignal })
    )

    if (admission.kind === 'rejected' && admission.reason === 'capacity') {
      break
    }

    if (admission.kind === 'rejected') {
      continue
    }

    // Not scheduler.job_failed: the run's own failure is already logged under that key, and what
    // escapes to here is the occurrence pipeline around it (claim, recovery, finish) failing.
    admission.completion.catch((err: unknown) => {
      deps.logger.error('scheduler.occurrence_failed', { jobId: job.id, err: formatErrForLog(err) })
    })
  }
}

function admitJob<T>(options: AdmitJobOptions<T>): SchedulerAdmission<T> {
  const { state, job, deps, execute } = options

  if (state.stopped || state.signal.aborted) {
    return { kind: 'rejected', reason: 'stopped' }
  }

  if (state.inFlight.has(job.id)) {
    return { kind: 'rejected', reason: 'busy' }
  }

  if (state.inFlight.size >= deps.config.schedule.maxGlobal) {
    return { kind: 'rejected', reason: 'capacity' }
  }

  const controller = new AbortController()
  const jobSignal = AbortSignal.any([controller.signal, state.signal])
  // The run settles before its deferred removal, so the removal is part of the completion that a
  // cancel or a stop waits on.
  const completion = execute(jobSignal).finally(() => runDeferredRemoval(state, deps, job.id))
  const tracked = completion.then(
    () => {
      state.inFlight.delete(job.id)
    },
    () => {
      state.inFlight.delete(job.id)
    }
  )

  state.inFlight.set(job.id, { jobId: job.id, controller, completion: tracked })
  return { kind: 'accepted', completion }
}

function deferRemoval(state: SchedulerState, jobId: JobId, remove: () => Promise<void>): boolean {
  if (!state.inFlight.has(jobId)) {
    return false
  }

  if (!state.deferredRemovals.has(jobId)) {
    state.deferredRemovals.set(jobId, remove)
  }

  return true
}

async function runDeferredRemoval(
  state: SchedulerState,
  deps: SchedulerDeps,
  jobId: JobId
): Promise<void> {
  const remove = state.deferredRemovals.get(jobId)

  if (remove === undefined) {
    return
  }

  state.deferredRemovals.delete(jobId)

  try {
    await remove()
  } catch (err: unknown) {
    deps.logger.warn('scheduler.deferred_remove_failed', { jobId, err: formatErrForLog(err) })
  }
}

async function cancelJob(state: SchedulerState, jobId: JobId): Promise<boolean> {
  const admitted = state.inFlight.get(jobId)

  if (admitted === undefined) {
    return false
  }

  admitted.controller.abort()
  await admitted.completion

  return true
}

function stopScheduler(
  state: SchedulerState,
  deps: SchedulerDeps,
  timeoutMs: number
): Promise<void> {
  state.stopTask ??= settleScheduler(state, deps, timeoutMs)
  return state.stopTask
}

async function settleScheduler(
  state: SchedulerState,
  deps: SchedulerDeps,
  timeoutMs: number
): Promise<void> {
  stopScheduling(state)

  if (timeoutMs <= 0) {
    return
  }

  const pending = pendingSchedulerTasks(state)

  if (pending.length === 0) {
    return
  }

  await waitForSchedulerTasks({ pending, timeoutMs, state, deps })
}

function stopScheduling(state: SchedulerState): void {
  state.stopped = true

  if (state.timer !== null) {
    clearTimeout(state.timer)
    state.timer = null
  }
  if (state.onAbort !== null) {
    state.signal.removeEventListener('abort', state.onAbort)
    state.onAbort = null
  }
}

function pendingSchedulerTasks(state: SchedulerState): Promise<void>[] {
  const pending = [...state.inFlight.values()].map((admitted) => admitted.completion)

  if (state.tickTask !== null) {
    pending.unshift(state.tickTask)
  }

  return pending
}

async function waitForSchedulerTasks(options: SchedulerWaitOptions): Promise<void> {
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | null = null

  try {
    await Promise.race([
      Promise.allSettled(options.pending),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true
          resolve()
        }, options.timeoutMs)
      }),
    ])
  } finally {
    if (timer !== null) {
      clearTimeout(timer)
    }
  }

  if (timedOut) {
    options.deps.logger.warn('scheduler.stop_timeout', { jobs: options.state.inFlight.size })
  }
}

// Any row left 'running' belongs to a daemon that died mid-job: nothing will ever finish it.
// Run-now work has no surviving executor after restart, so clear its claim only after that sweep —
// and only for claims predating boot, since this sweep races operator run-now claims taken since.
async function recoverAfterBoot(deps: SchedulerDeps): Promise<void> {
  const now = Date.now()

  try {
    await deps.occurrences.markStale(now)
    await deps.jobStore.clearRunNowClaims(now)
  } catch (err: unknown) {
    deps.logger.warn('scheduler.history_sweep_failed', { err: formatErrForLog(err) })
  }
}
