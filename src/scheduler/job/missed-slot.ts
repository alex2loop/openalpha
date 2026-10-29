import type { Job, SchedulerClaim, SchedulerDeps, SchedulerRunOutcome } from '@/scheduler/types'
import { finalizeOccurrence } from '@/scheduler/job/finalize'
import { computeTransition, MISSED_SLOT_MESSAGE } from '@/scheduler/job/outcome'

interface SkipMissedSlotOptions {
  readonly job: Job
  readonly deps: SchedulerDeps
  readonly claim: SchedulerClaim
  readonly now: number
}

// A cron slot answered long after its clock time is work for a session that has passed. An interval
// job names no clock time, so late is still on time for it; a once job has no later slot.
export function isMissedSlot(job: Job, now: number, graceMs: number): boolean {
  return job.schedule.kind === 'cron' && now - job.nextRunAt > graceMs
}

// Closes the claimed occurrence without running it and moves the cadence to the next slot. No
// failure is counted: the job is not broken, the daemon or the network was away.
export async function skipMissedSlot(options: SkipMissedSlotOptions): Promise<void> {
  const { job, deps, claim, now } = options
  const outcome: SchedulerRunOutcome = {
    status: 'failed',
    endedAtMs: now,
    errorMessage: MISSED_SLOT_MESSAGE,
  }
  const transition = computeTransition(job, outcome, now)
  const finalization = await finalizeOccurrence({ deps, job, claim, outcome, transition })

  if (finalization === 'finalized') {
    deps.logger.info('scheduler.slot_missed', { jobId: job.id, lateMs: now - job.nextRunAt })
  }
}
