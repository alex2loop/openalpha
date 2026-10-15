import type {
  Job,
  SchedulerClaim,
  SchedulerDeps,
  SchedulerJobTransition,
  SchedulerRunOutcome,
} from '@/scheduler/types'
import { StorageError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { withRetry } from '@/core/utils/retry'

const FINALIZE_RETRY_ATTEMPTS = 3

interface FinalizeOccurrenceOptions {
  readonly deps: SchedulerDeps
  readonly job: Job
  readonly claim: SchedulerClaim
  readonly outcome: SchedulerRunOutcome
  readonly transition: SchedulerJobTransition
}

// Takes no signal: shutdown and cancel abort the job's signal, and the outcome they produce is
// exactly what has to be written.
export async function finalizeOccurrence(
  options: FinalizeOccurrenceOptions
): Promise<'finalized' | 'conflict' | 'storage_failed'> {
  const { deps, job, claim, outcome, transition } = options

  try {
    const finalized = await withRetry(
      () =>
        deps.occurrences.finalize({
          runId: claim.runId,
          token: claim.token,
          jobId: job.id,
          outcome,
          transition,
        }),
      {
        maxAttempts: FINALIZE_RETRY_ATTEMPTS,
        // Only a storage fault can clear on retry; anything else burns the backoff to fail again.
        isRetryable: (err) => err instanceof StorageError,
      }
    )

    if (!finalized) {
      deps.logger.warn('scheduler.finalization_conflict', { jobId: job.id, runId: claim.runId })

      return 'conflict'
    }

    return 'finalized'
  } catch (err: unknown) {
    deps.logger.warn('scheduler.finalization_failed', {
      jobId: job.id,
      runId: claim.runId,
      err: formatErrForLog(err),
    })

    return 'storage_failed'
  }
}
