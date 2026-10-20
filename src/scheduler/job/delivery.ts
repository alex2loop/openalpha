import type { RunResult } from '@/engine/api'
import type {
  Job,
  SchedulerDeps,
  SchedulerJobTransition,
  SchedulerRunOutcome,
} from '@/scheduler/types'
import { formatErrForLog } from '@/core/security/credentials'
import { CRON_AUTO_DISABLE_THRESHOLD, UNCOUNTED_HALT_MESSAGES } from '@/scheduler/job/outcome'

interface AutoDisableNoticeInput {
  readonly job: Job
  readonly transition: SchedulerJobTransition
  readonly outcome: SchedulerRunOutcome
  readonly deps: SchedulerDeps
}

// A scheduled run has no one watching it stream, so its answer arrives as one proactive notice.
// Returns the failure message when delivery fails, so the caller can record it on the occurrence.
export async function deliverText(
  job: Job,
  text: string,
  deps: SchedulerDeps
): Promise<string | undefined> {
  try {
    await notify(job, deps, text)
    return undefined
  } catch (err: unknown) {
    const formatted = formatErrForLog(err)
    deps.logger.warn('scheduler.delivery_failed', { jobId: job.id, err: formatted })
    return formatted.message
  }
}

export async function deliverPartial(
  job: Job,
  result: RunResult,
  deps: SchedulerDeps
): Promise<void> {
  if (result.text.trim() === '') {
    return
  }

  await deliverText(job, deps.renderPartialNotice(result), deps)
}

export async function notifyIfAutoDisabled(input: AutoDisableNoticeInput): Promise<void> {
  const { job, transition, outcome, deps } = input
  const isAutoDisable =
    transition.kind === 'disable' &&
    outcome.status !== 'success' &&
    !UNCOUNTED_HALT_MESSAGES.has(outcome.errorMessage)

  if (!isAutoDisable) {
    return
  }

  const target = deps.failureTarget()

  if (target === undefined) {
    return
  }

  try {
    const text = deps.renderAutoDisableNotice(job.id, CRON_AUTO_DISABLE_THRESHOLD)

    await deps.notifier.notify(target, text)
  } catch (err: unknown) {
    deps.logger.warn('scheduler.disable_notify_failed', {
      jobId: job.id,
      err: formatErrForLog(err),
    })
  }
}

// A CLI-created job has no chatId, so it falls back to whichever channel declared one.
async function notify(job: Job, deps: SchedulerDeps, text: string): Promise<void> {
  if (text.trim() === '') {
    return
  }

  const target = job.target ?? deps.defaultTarget()

  if (target === undefined) {
    deps.logger.warn('scheduler.no_delivery_target', { jobId: job.id })
    return
  }

  await deps.notifier.notify(target, text)
}
