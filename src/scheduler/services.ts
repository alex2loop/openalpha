import type { App, ServiceProvider } from '@/core/container'
import type { AgentProfile } from '@/engine/api'
import type { HeartbeatDeps } from '@/scheduler/heartbeat/types'
import type { SchedulerController } from '@/scheduler/runner'
import type {
  Job,
  JobOwner,
  SchedulerCommandResult,
  SchedulerCommands,
  SchedulerDeps,
  SchedulerRunNowInput,
} from '@/scheduler/types'
import { formatErrForLog } from '@/core/security/credentials'
import { advanceCron } from '@/core/utils/cron'
import { startHeartbeats } from '@/scheduler/heartbeat/runner'
import { type ClaimedJobRunResult, runClaimedScheduledJob } from '@/scheduler/job/execution'
import { SCHEDULER_STOP_TIMEOUT_MS, startScheduler } from '@/scheduler/runner'

declare module '@/core/container' {
  interface Services {
    schedulerTask: { readonly name: string; start(signal: AbortSignal): Promise<void> }
    schedulerCommands: SchedulerCommands
  }
}

export type SchedulerTaskDeps = SchedulerDeps & { readonly heartbeat: HeartbeatDeps }

const MAX_PREFIX_MATCHES = 2

interface SchedulerCommandDeps {
  readonly scheduler: SchedulerDeps
  readonly controller: () => SchedulerController | null
}

interface OwnedJobOperation {
  readonly deps: SchedulerCommandDeps
  readonly owner: JobOwner
  readonly idOrPrefix: string
}

interface RunJobOperation extends SchedulerRunNowInput {
  readonly deps: SchedulerCommandDeps
}

interface ClaimedJobRun {
  readonly deps: SchedulerCommandDeps
  readonly owner?: JobOwner
  readonly job: Job
  readonly requestId: string
  readonly signal: AbortSignal
}

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
}

// Deps are built lazily from `app`: the scheduler's DeliverySink is the channel notifier, which
// only exists once the daemon has started the channels.
export function createSchedulerProvider(build: (app: App) => SchedulerTaskDeps): ServiceProvider {
  let controller: SchedulerController | null = null

  return {
    name: 'scheduler',
    register(bind): void {
      bind('schedulerCommands', (app) =>
        createSchedulerCommands({
          scheduler: build(app),
          controller: () => controller,
        })
      )
      bind('schedulerTask', (app) => ({
        name: 'scheduler',
        async start(signal): Promise<void> {
          // Guard before arming: on an already-aborted signal the abort listener below would
          // never fire and this promise would never settle.
          if (signal.aborted) {
            return
          }
          const deps = build(app)
          const agents = (): readonly AgentProfile[] => deps.heartbeat.agents.all()

          // The fallible step runs before anything is armed: a rejection here leaves no tick
          // running that nothing would stop.
          await deps.heartbeat.store.syncAgents(agents().map((agent) => agent.id))

          const running = startScheduler(deps, signal)
          const stopHeartbeat = startHeartbeats(deps.heartbeat, agents, signal)
          let stopped = false
          const stop = async (): Promise<void> => {
            if (stopped) {
              return
            }
            stopped = true

            const heartbeatStopped = stopHeartbeat()

            await running.stop(SCHEDULER_STOP_TIMEOUT_MS).catch((err: unknown) => {
              deps.logger.warn('scheduler.stop_failed', { err: formatErrForLog(err) })
            })
            await heartbeatStopped
          }

          // After syncAgents the signal may have already aborted. Stopping here avoids arming a
          // listener that would never fire, leaving this task pending forever.
          if (signal.aborted) {
            await stop()
            return
          }

          controller = running
          const { promise, resolve } = createDeferred<void>()
          const onAbort = (): void => {
            stop().then(
              () => resolve(),
              () => resolve()
            )
          }

          signal.addEventListener('abort', onAbort)
          try {
            await promise
          } finally {
            signal.removeEventListener('abort', onAbort)
            if (controller === running) {
              controller = null
            }
          }
        },
      }))
    },
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

function createSchedulerCommands(deps: SchedulerCommandDeps): SchedulerCommands {
  return {
    list: (owner) => deps.scheduler.jobStore.listOwned(owner),
    show: (owner, idOrPrefix) => resolveOwnedJob({ deps, owner, idOrPrefix }),
    pause: (owner, idOrPrefix) => pauseOwnedJob({ deps, owner, idOrPrefix }),
    resume: (owner, idOrPrefix) => resumeOwnedJob({ deps, owner, idOrPrefix }),
    runNow: (input) => runJobNow({ deps, ...input }),
    remove: async (owner, idOrPrefix) =>
      removeJob(deps, await resolveOwnedJob({ deps, owner, idOrPrefix })),
    removeAny: async (idOrPrefix) => removeJob(deps, await resolveAnyJob(deps, idOrPrefix)),
    pauseAny: (idOrPrefix) => pauseAnyJob(deps, idOrPrefix),
    resumeAny: (idOrPrefix) => resumeAnyJob(deps, idOrPrefix),
  }
}

async function pauseAnyJob(
  deps: SchedulerCommandDeps,
  idOrPrefix: string
): Promise<SchedulerCommandResult> {
  const resolved = await resolveAnyJob(deps, idOrPrefix)

  if (resolved.kind !== 'job') {
    return resolved
  }

  const updated = await deps.scheduler.jobStore.pause(resolved.job.id)

  return updated ? { kind: 'job', job: { ...resolved.job, enabled: false } } : { kind: 'not_found' }
}

async function resumeAnyJob(
  deps: SchedulerCommandDeps,
  idOrPrefix: string
): Promise<SchedulerCommandResult> {
  const resolved = await resolveAnyJob(deps, idOrPrefix)

  if (resolved.kind !== 'job') {
    return resolved
  }

  const nextRunAt = nextRunAfterResume(resolved.job, Date.now())
  const updated = await deps.scheduler.jobStore.resume(resolved.job.id, nextRunAt)

  return updated
    ? { kind: 'job', job: { ...resolved.job, enabled: true, nextRunAt, consecutiveFailures: 0 } }
    : { kind: 'not_found' }
}

async function pauseOwnedJob(options: OwnedJobOperation): Promise<SchedulerCommandResult> {
  const { deps, owner } = options
  const resolved = await resolveOwnedJob(options)

  if (resolved.kind !== 'job') {
    return resolved
  }

  const updated = await deps.scheduler.jobStore.pauseOwned(owner, resolved.job.id)

  return updated ? { kind: 'job', job: { ...resolved.job, enabled: false } } : { kind: 'not_found' }
}

async function resumeOwnedJob(options: OwnedJobOperation): Promise<SchedulerCommandResult> {
  const { deps, owner } = options
  const resolved = await resolveOwnedJob(options)

  if (resolved.kind !== 'job') {
    return resolved
  }

  const now = Date.now()
  const nextRunAt = nextRunAfterResume(resolved.job, now)
  const updated = await deps.scheduler.jobStore.resumeOwned(owner, resolved.job.id, nextRunAt)

  return updated
    ? { kind: 'job', job: { ...resolved.job, enabled: true, nextRunAt, consecutiveFailures: 0 } }
    : { kind: 'not_found' }
}

function nextRunAfterResume(job: Job, now: number): number {
  if (job.schedule.kind === 'once') {
    return Math.max(job.schedule.at, now)
  }
  if (job.schedule.kind === 'interval') {
    return now + job.schedule.everyMs
  }

  return advanceCron(job.schedule.expr, new Date(now), job.schedule.timezone).getTime()
}

async function runJobNow(options: RunJobOperation): Promise<SchedulerCommandResult> {
  const { deps, owner, idOrPrefix, requestId, signal, appendPrompt } = options
  const resolved =
    owner === undefined
      ? await resolveAnyJob(deps, idOrPrefix)
      : await resolveOwnedJob({ deps, owner, idOrPrefix })

  if (resolved.kind !== 'job') {
    return resolved
  }

  const job = await claimRun(options, resolved.job)

  if (job === undefined) {
    return { kind: 'rejected' }
  }

  const result = await admitClaimedJob({
    deps,
    job: appendPrompt === undefined ? job : { ...job, prompt: `${job.prompt}\n\n${appendPrompt}` },
    requestId,
    signal,
    ...(owner === undefined ? {} : { owner }),
  })

  // The caller gets the job as stored, not as this one run read it.
  return result.kind === 'job' ? { kind: 'job', job } : result
}

async function claimRun(options: RunJobOperation, job: Job): Promise<Job | undefined> {
  const { deps, owner, requestId } = options
  const claimedAt = Date.now()

  try {
    return await (owner === undefined
      ? deps.scheduler.jobStore.claimRunNow(job.id, requestId, claimedAt)
      : deps.scheduler.jobStore.claimRunNowOwned(owner, job.id, requestId, claimedAt))
  } catch (err: unknown) {
    deps.scheduler.logger.warn('scheduler.run_now_claim_failed', {
      jobId: job.id,
      err: formatErrForLog(err),
    })

    return undefined
  }
}

async function admitClaimedJob(options: ClaimedJobRun): Promise<SchedulerCommandResult> {
  const { deps, job } = options
  const controller = deps.controller()

  // Without a daemon there is no concurrency controller to admit through; the database claim taken
  // above is what keeps two processes off the same job, so the run proceeds and still records.
  const completion =
    controller === null ? runUncontrolledJob(options) : admitThroughController(controller, options)

  try {
    const result = await completion

    if (result === undefined) {
      await releaseClaim(options)

      return { kind: 'rejected' }
    }

    return result.kind === 'finished' && result.completed
      ? { kind: 'job', job }
      : { kind: 'rejected' }
  } catch (err: unknown) {
    // Not scheduler.run_now_failed: the run's own failure is already logged under that key, and what
    // escapes to here is the admission/completion pipeline around it failing.
    deps.scheduler.logger.error('scheduler.run_now_occurrence_failed', {
      jobId: job.id,
      err: formatErrForLog(err),
    })

    return { kind: 'rejected' }
  }
}

function admitThroughController(
  controller: NonNullable<ReturnType<SchedulerCommandDeps['controller']>>,
  options: ClaimedJobRun
): Promise<ClaimedJobRunResult | undefined> {
  const { deps, owner, job, requestId } = options
  const admission = controller.admit(job, (signal) =>
    runClaimedScheduledJob({
      job,
      deps: deps.scheduler,
      signal,
      requestId,
      ...(owner === undefined ? {} : { owner }),
    })
  )

  return admission.kind === 'rejected' ? Promise.resolve(undefined) : admission.completion
}

function runUncontrolledJob(options: ClaimedJobRun): Promise<ClaimedJobRunResult> {
  const { deps, owner, job, requestId, signal } = options

  return runClaimedScheduledJob({
    job,
    deps: deps.scheduler,
    signal,
    requestId,
    ...(owner === undefined ? {} : { owner }),
  })
}

async function removeJob(
  deps: SchedulerCommandDeps,
  resolved: SchedulerCommandResult
): Promise<SchedulerCommandResult> {
  if (resolved.kind !== 'job') {
    return resolved
  }

  const job = resolved.job
  const controller = deps.controller()

  if (controller !== null) {
    await controller.cancel(job.id)
  }

  await deps.scheduler.jobStore.remove(job.id)
  await retireEventAlert(deps, job)

  return { kind: 'job', job }
}

// A price job armed an alert of its own; the alert goes with the job, from whichever surface
// removed it. A failure is logged, not raised: the job is already gone and the alert would only
// send its one notice.
async function retireEventAlert(deps: SchedulerCommandDeps, job: Job): Promise<void> {
  const alertId = job.event?.alertId

  if (alertId === undefined || deps.scheduler.onEventJobRemoved === undefined) {
    return
  }

  try {
    await deps.scheduler.onEventJobRemoved(alertId)
  } catch (err: unknown) {
    deps.scheduler.logger.warn('scheduler.event_alert_disable_failed', {
      jobId: job.id,
      err: formatErrForLog(err),
    })
  }
}

async function resolveOwnedJob(options: OwnedJobOperation): Promise<SchedulerCommandResult> {
  const { deps, owner, idOrPrefix } = options
  const prefix = idOrPrefix.trim()

  if (prefix === '') {
    return { kind: 'invalid' }
  }

  const matches = await deps.scheduler.jobStore.findOwnedByPrefix(owner, prefix, MAX_PREFIX_MATCHES)

  return pickPrefixMatch(matches, prefix)
}

async function resolveAnyJob(
  deps: SchedulerCommandDeps,
  idOrPrefix: string
): Promise<SchedulerCommandResult> {
  const prefix = idOrPrefix.trim()

  if (prefix === '') {
    return { kind: 'invalid' }
  }

  const matches = await deps.scheduler.jobStore.findByPrefix(prefix, MAX_PREFIX_MATCHES)

  return pickPrefixMatch(matches, prefix)
}

// A full id wins over the prefix shortcut: `report` must resolve even when `report-weekly` exists.
function pickPrefixMatch(matches: readonly Job[], prefix: string): SchedulerCommandResult {
  const exact = matches.find((candidate) => candidate.id === prefix)

  if (exact !== undefined) {
    return { kind: 'job', job: exact }
  }

  const job = matches[0]

  if (job === undefined) {
    return { kind: 'not_found' }
  }

  return matches.length > 1 ? { kind: 'ambiguous' } : { kind: 'job', job }
}

async function releaseClaim(options: ClaimedJobRun): Promise<void> {
  const { deps, owner, job, requestId } = options
  try {
    await (owner === undefined
      ? deps.scheduler.jobStore.releaseRunNowClaim(job.id, requestId)
      : deps.scheduler.jobStore.releaseRunNowClaimOwned(owner, job.id, requestId))
  } catch (err: unknown) {
    deps.scheduler.logger.warn('scheduler.run_now_claim_release_failed', {
      jobId: job.id,
      err: formatErrForLog(err),
    })
  }
}
