import { randomUUID } from 'node:crypto'

import type { Logger } from '@/core/logging/logger'
import type { EventJobTrigger } from '@/scheduler/event/types'
import type { Job, JobStore, SchedulerCommands } from '@/scheduler/types'
import { formatErrForLog } from '@/core/security/credentials'

/** Event runs in flight at once. A burst of crossings past it is dropped rather than queued: the
 *  alert already reached the operator, and a run started late reads a price that has moved on. */
const MAX_EVENT_RUNS = 20
/** Every name an any-name job meets shares one cooldown row, so it runs at most once per cooldown. */
const ANY_NAME_FIRE_KEY = '*'

interface EventMatchDeps {
  readonly jobs: Pick<JobStore, 'matchEvent' | 'claimEventFire'>
  readonly commands: Pick<SchedulerCommands, 'runNow'>
  /** Owned by the caller, which empties it on stop; each run takes itself out when it settles. */
  readonly runs: Set<Promise<void>>
  readonly logger: Logger
  /** Told how many of a firing's matched jobs found the runs full; `createDropLog` makes it. */
  readonly logDropped: (dropped: number) => void
  /** The daemon's shutdown signal: a crossing's run outlives the alert pass that raised it. */
  readonly signal: AbortSignal
}

/** Starts every enabled event job this alert matches, once per cooldown, without awaiting the
 *  runs. A job that is busy drops this fire. */
export async function fireMatchingJobs(
  deps: EventMatchDeps,
  trigger: EventJobTrigger,
  appendPrompt: string
): Promise<void> {
  const { market, ticker } = trigger.instrument
  const jobs = await deps.jobs.matchEvent({
    event: trigger.event,
    market,
    ticker,
    alertId: trigger.alertId,
  })

  let dropped = 0

  for (const job of jobs) {
    if (deps.runs.size >= MAX_EVENT_RUNS) {
      dropped += 1
      continue
    }

    if (await claimCooldown(deps, job, trigger)) {
      startRun(deps, job, appendPrompt)
    }
  }

  // A firing that matched nothing says nothing about room, so only a matched one reports.
  if (jobs.length > 0) {
    deps.logDropped(dropped)
  }
}

/** The first drop past the cap says so with its count; the rest stay quiet until a firing whose
 *  matched jobs all fit re-arms it. */
export function createDropLog(logger: Logger): (dropped: number) => void {
  let dropLogged = false

  return (dropped) => {
    if (dropped === 0) {
      dropLogged = false
      return
    }

    if (!dropLogged) {
      dropLogged = true
      logger.warn('scheduler.event_run_dropped', { dropped, reason: 'runs_full' })
    }
  }
}

async function claimCooldown(
  deps: EventMatchDeps,
  job: Job,
  trigger: EventJobTrigger
): Promise<boolean> {
  if (job.event === undefined) {
    return false
  }

  try {
    return await deps.jobs.claimEventFire({
      jobId: job.id,
      fireKey: fireKeyOf(job.event.ticker, trigger),
      firedAt: trigger.firedAt,
      cooldownMs: job.event.cooldownMs,
    })
  } catch (err: unknown) {
    deps.logger.warn('scheduler.event_claim_failed', { jobId: job.id, err: formatErrForLog(err) })

    return false
  }
}

function fireKeyOf(named: string | undefined, trigger: EventJobTrigger): string {
  const { market, ticker } = trigger.instrument

  return named === undefined ? ANY_NAME_FIRE_KEY : `${market}:${ticker}`
}

function startRun(deps: EventMatchDeps, job: Job, appendPrompt: string): void {
  const run: Promise<void> = deps.commands
    .runNow({ idOrPrefix: job.id, requestId: randomUUID(), appendPrompt, signal: deps.signal })
    .then(
      (result) => {
        if (result.kind !== 'job') {
          deps.logger.info('scheduler.event_run_refused', { jobId: job.id, reason: result.kind })
        }
      },
      (err: unknown) => {
        deps.logger.warn('scheduler.event_run_failed', {
          jobId: job.id,
          err: formatErrForLog(err),
        })
      }
    )
    .finally(() => {
      deps.runs.delete(run)
    })

  deps.runs.add(run)
}
