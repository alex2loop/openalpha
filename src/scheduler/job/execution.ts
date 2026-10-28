import { randomUUID } from 'node:crypto'

import type {
  Job,
  JobOwner,
  SchedulerClaim,
  SchedulerDeps,
  SchedulerOccurrenceClaim,
  SchedulerRunOutcome,
} from '@/scheduler/types'
import { withCorrelation } from '@/core/logging/correlation'
import { formatErrForLog } from '@/core/security/credentials'
import { type JobExecution, runAgent } from '@/scheduler/job/agent-run'
import { deliverPartial, deliverText, notifyIfAutoDisabled } from '@/scheduler/job/delivery'
import { finalizeOccurrence } from '@/scheduler/job/finalize'
import {
  advanceJob,
  computeOutcome,
  computeTransition,
  isAbortHalt,
  SHUTDOWN_MESSAGE,
} from '@/scheduler/job/outcome'

const STALLED_OUTCOME_MESSAGE = 'stalled run recovered; outcome was not recorded'
// Wall-clock lease, independent of the engine's own duration clock (which pauses for an open
// approval prompt): renewing on a fixed interval keeps the lease fresh for as long as a live
// process is actually attending to the run, however long the run's real wall-clock time is.
const OCCURRENCE_LEASE_TTL_MS = 300_000
const OCCURRENCE_LEASE_RENEW_INTERVAL_MS = 120_000

interface RunScheduledOccurrenceOptions {
  readonly job: Job
  readonly deps: SchedulerDeps
  readonly signal: AbortSignal
}

interface RunScheduledJobOptions extends RunScheduledOccurrenceOptions {
  readonly claim: SchedulerClaim
}

interface RunClaimedScheduledJobOptions {
  readonly job: Job
  readonly deps: SchedulerDeps
  readonly signal: AbortSignal
  readonly requestId: string
  readonly owner?: JobOwner
  /** Started by a price crossing: only that run spends a price job. */
  readonly crossing: boolean
}

interface FinishScheduledExecutionOptions {
  readonly job: Job
  readonly deps: SchedulerDeps
  readonly claim: SchedulerClaim
  readonly execution: JobExecution
}

interface FinishScheduledThrownOptions {
  readonly job: Job
  readonly deps: SchedulerDeps
  readonly claim: SchedulerClaim
  readonly err: unknown
}

interface FinishRunNowExecutionOptions {
  readonly job: Job
  readonly deps: SchedulerDeps
  readonly runId: number
  readonly crossing: boolean
  readonly execution: JobExecution
}

interface FinishRunNowThrownOptions {
  readonly job: Job
  readonly deps: SchedulerDeps
  readonly runId: number
  readonly crossing: boolean
  readonly err: unknown
}

export type ClaimedJobRunResult =
  | { readonly kind: 'rejected' }
  | { readonly kind: 'finished'; readonly completed: boolean }

// Owns the occurrence: it claims the slot for `job.nextRunAt` and finalizes it on every path.
export async function runScheduledOccurrence(
  options: RunScheduledOccurrenceOptions
): Promise<void> {
  const { job, deps, signal } = options
  const startedAtMs = Date.now()
  const claim = await deps.occurrences.claim({
    jobId: job.id,
    scheduledFor: job.nextRunAt,
    token: randomUUID(),
    startedAtMs,
    leaseUntilMs: startedAtMs + OCCURRENCE_LEASE_TTL_MS,
  })

  if (claim.kind === 'claimed') {
    await runScheduledJob({ job, deps, signal, claim })
    return
  }

  if (claim.kind === 'already_claimed' && claim.status === 'failed') {
    await recoverStalledJob(job, deps, claim)
    return
  }

  // A 'running' claim with a live lease has an executor still attending it elsewhere: leave the
  // job's cadence untouched and let this tick's attempt lapse -- the next tick re-checks.
  if (claim.kind === 'already_claimed' && claim.status === 'running') {
    if (claim.leaseUntilMs !== null && Date.now() < claim.leaseUntilMs) {
      deps.logger.info('scheduler.occurrence_lease_live', { jobId: job.id, runId: claim.runId })
      return
    }

    await recoverStalledJob(job, deps, claim)
    return
  }

  deps.logger.warn('scheduler.claim_no_op', {
    jobId: job.id,
    kind: claim.kind,
    ...(claim.kind === 'already_claimed' ? { status: claim.status } : {}),
  })
}

// A row left 'failed', or 'running' with an expired lease, has no live executor: close it out
// (when still 'running') and move the cadence on rather than re-running a spent occurrence.
async function recoverStalledJob(
  job: Job,
  deps: SchedulerDeps,
  stalled: Extract<SchedulerOccurrenceClaim, { kind: 'already_claimed' }>
): Promise<void> {
  const now = Date.now()
  const outcome: SchedulerRunOutcome = {
    status: 'failed',
    endedAtMs: now,
    errorMessage: STALLED_OUTCOME_MESSAGE,
  }

  try {
    if (stalled.status === 'running') {
      await deps.occurrences.finish(stalled.runId, outcome)
    }

    await settleStalledJob({ job, deps, outcome, now })
  } catch (err: unknown) {
    deps.logger.warn('scheduler.stalled_recovery_failed', {
      jobId: job.id,
      err: formatErrForLog(err),
    })
  }
}

interface SettleStalledJobOptions {
  readonly job: Job
  readonly deps: SchedulerDeps
  readonly outcome: SchedulerRunOutcome
  readonly now: number
}

// A once job has no next occurrence to move on to, so the lost run counts as a failure like any
// other: it is due again after the backoff and disabled, with a notice, at the failure threshold.
async function settleStalledJob(options: SettleStalledJobOptions): Promise<void> {
  const { job, deps, outcome, now } = options

  if (job.schedule.kind !== 'once') {
    await advanceJob(job, deps, now)
    return
  }

  const transition = computeTransition(job, outcome, now)

  if (transition.kind === 'retry') {
    await deps.jobStore.deferRetry(job.id, transition.failures, transition.nextRunAt)
    return
  }

  await deps.jobStore.disable(job.id)
  await notifyIfAutoDisabled({ job, transition, outcome, deps })
}

async function runScheduledJob(options: RunScheduledJobOptions): Promise<void> {
  const { job, deps, signal, claim } = options
  const stopLeaseRenewal = startLeaseRenewal({ deps, claim, signal })

  try {
    const execution = await runAgent(job, deps, { signal })

    await finishScheduledExecution({ job, deps, claim, execution })
  } catch (err: unknown) {
    await finishScheduledThrownExecution({ job, deps, claim, err })
  } finally {
    stopLeaseRenewal()
  }
}

interface StartLeaseRenewalOptions {
  readonly deps: SchedulerDeps
  readonly claim: SchedulerClaim
  readonly signal: AbortSignal
}

// The executor's side of the lease: renews on a fixed wall-clock interval for as long as this run
// is in flight, so a second reader's staleness check reflects "is a process still here", not "has
// the run exceeded some assumed duration".
function startLeaseRenewal(options: StartLeaseRenewalOptions): () => void {
  const { deps, claim, signal } = options

  if (signal.aborted) {
    return () => undefined
  }

  const renew = (): void => {
    deps.occurrences
      .renewLease(claim.runId, claim.token, Date.now() + OCCURRENCE_LEASE_TTL_MS)
      .catch((err: unknown) => {
        deps.logger.warn('scheduler.lease_renew_failed', {
          runId: claim.runId,
          err: formatErrForLog(err),
        })
      })
  }
  const timer = setInterval(renew, OCCURRENCE_LEASE_RENEW_INTERVAL_MS)
  timer.unref()

  const stop = (): void => {
    clearInterval(timer)
    signal.removeEventListener('abort', stop)
  }
  signal.addEventListener('abort', stop, { once: true })

  return stop
}

export function runClaimedScheduledJob(
  options: RunClaimedScheduledJobOptions
): Promise<ClaimedJobRunResult> {
  return withCorrelation(options.requestId, () => runClaimedJob(options))
}

async function runClaimedJob(options: RunClaimedScheduledJobOptions): Promise<ClaimedJobRunResult> {
  const { job, deps, signal, requestId, owner, crossing } = options
  const startedAt = Date.now()
  let runId: number | undefined

  try {
    const execution = await runAgent(job, deps, {
      signal,
      onWorkStart: async () => {
        runId = await deps.occurrences.startRunNow(job.id, requestId, startedAt)
      },
    })

    if (runId === undefined) {
      return { kind: 'rejected' }
    }

    try {
      const completed = await finishRunNowExecution({ job, deps, runId, crossing, execution })

      return { kind: 'finished', completed }
    } catch (err: unknown) {
      await finishRunNowThrownExecution({ job, deps, runId, crossing, err })

      return { kind: 'finished', completed: false }
    }
  } catch (err: unknown) {
    if (runId === undefined) {
      deps.logger.warn('scheduler.run_now_admission_failed', {
        jobId: job.id,
        err: formatErrForLog(err),
      })

      return { kind: 'rejected' }
    }

    await finishRunNowThrownExecution({ job, deps, runId, crossing, err })

    return { kind: 'finished', completed: false }
  } finally {
    await releaseRunNowClaim({ deps, job, requestId, ...(owner === undefined ? {} : { owner }) })
  }
}

async function finishScheduledExecution(options: FinishScheduledExecutionOptions): Promise<void> {
  const { job, deps, claim, execution } = options
  // One instant for the whole finish: the occurrence's endedAt and the job's nextRunAt must agree.
  const now = Date.now()
  const outcome = computeOutcome(execution.result, execution.denied, now)
  const transition = computeTransition(job, outcome, now)
  const finalization = await finalizeOccurrence({ deps, job, claim, outcome, transition })

  // A lost claim means another executor owns this occurrence and will deliver it. A storage fault
  // does not: the paid result is still in hand, and dropping it here loses it for good.
  if (finalization === 'conflict') {
    return
  }

  const finalized = finalization === 'finalized'

  // Debug, once per run: the unset key itself is warned at start and listed by `status`.
  if (outcome.status === 'failed' && outcome.missingEnv !== undefined) {
    deps.logger.debug('scheduler.job_key_missing', { jobId: job.id, env: outcome.missingEnv })
  }

  if (finalized) {
    await notifyIfAutoDisabled({ job, transition, outcome, deps })
  }

  if (outcome.status === 'success') {
    const deliveryError = await deliverText(job, execution.result.text, deps)

    if (deliveryError !== undefined && finalized) {
      await deps.occurrences.recordDeliveryError(claim.runId, deliveryError)
    }

    return
  }

  await deliverPartial(job, execution.result, deps)
}

async function finishScheduledThrownExecution(
  options: FinishScheduledThrownOptions
): Promise<void> {
  const { job, deps, claim, err } = options
  const formatted = formatErrForLog(err)

  deps.logger.error('scheduler.job_failed', { jobId: job.id, err: formatted })

  const now = Date.now()
  const outcome: SchedulerRunOutcome = {
    status: 'failed',
    endedAtMs: now,
    errorMessage: isAbortHalt(err) ? SHUTDOWN_MESSAGE : formatted.message,
  }
  const transition = computeTransition(job, outcome, now)
  const finalization = await finalizeOccurrence({ deps, job, claim, outcome, transition })

  if (finalization === 'finalized') {
    await notifyIfAutoDisabled({ job, transition, outcome, deps })
  }
}

async function finishRunNowExecution(options: FinishRunNowExecutionOptions): Promise<boolean> {
  const { job, deps, runId, crossing, execution } = options
  const now = Date.now()
  const outcome = computeOutcome(execution.result, execution.denied, now)

  await finishRunNow(deps, runId, outcome)

  // Run-now leaves the schedule untouched; without this a `once` job fires again when it comes due.
  // A price job is spent by its one crossing whether or not the run succeeded: no later alert will
  // start it again. A manual run crossed nothing, so the job stays armed with its alert.
  if (
    spendsCrossing(job, crossing) ||
    (outcome.status === 'success' && job.schedule.kind === 'once' && !isPriceJob(job))
  ) {
    await advanceJob(job, deps, now).catch((err: unknown) => {
      deps.logger.warn('scheduler.run_now_advance_failed', {
        jobId: job.id,
        err: formatErrForLog(err),
      })
    })
  }

  if (outcome.status === 'success') {
    const deliveryError = await deliverText(job, execution.result.text, deps)

    if (deliveryError !== undefined) {
      await deps.occurrences.recordDeliveryError(runId, deliveryError)
    }

    return true
  }

  await deliverPartial(job, execution.result, deps)
  return false
}

async function finishRunNowThrownExecution(options: FinishRunNowThrownOptions): Promise<void> {
  const { job, deps, runId, crossing, err } = options
  const formatted = formatErrForLog(err)

  deps.logger.error('scheduler.run_now_failed', { jobId: job.id, err: formatted })
  await finishRunNow(deps, runId, {
    status: 'failed',
    endedAtMs: Date.now(),
    errorMessage: isAbortHalt(err) ? SHUTDOWN_MESSAGE : formatted.message,
  })

  // The crossing this run was for is spent however the run ended.
  if (spendsCrossing(job, crossing)) {
    await advanceJob(job, deps, Date.now()).catch((advanceErr: unknown) => {
      deps.logger.warn('scheduler.run_now_spend_failed', {
        jobId: job.id,
        err: formatErrForLog(advanceErr),
      })
    })
  }
}

function isPriceJob(job: Job): boolean {
  return job.event?.event === 'price'
}

function spendsCrossing(job: Job, crossing: boolean): boolean {
  return crossing && isPriceJob(job)
}

async function finishRunNow(
  deps: SchedulerDeps,
  runId: number,
  outcome: SchedulerRunOutcome
): Promise<void> {
  try {
    await deps.occurrences.finishRunNow(runId, outcome)
  } catch (err: unknown) {
    deps.logger.warn('scheduler.run_now_finish_failed', { runId, err: formatErrForLog(err) })
  }
}

interface ReleaseRunNowClaimOptions {
  readonly deps: SchedulerDeps
  readonly owner?: JobOwner
  readonly job: Job
  readonly requestId: string
}

async function releaseRunNowClaim(options: ReleaseRunNowClaimOptions): Promise<void> {
  const { deps, owner, job, requestId } = options

  try {
    await (owner === undefined
      ? deps.jobStore.releaseRunNowClaim(job.id, requestId)
      : deps.jobStore.releaseRunNowClaimOwned(owner, job.id, requestId))
  } catch (err: unknown) {
    deps.logger.warn('scheduler.run_now_claim_release_failed', {
      jobId: job.id,
      err: formatErrForLog(err),
    })
  }
}
