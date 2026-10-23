import { randomUUID } from 'node:crypto'

import type { App } from '@/core/container'
import type { JobId } from '@/core/ids'
import type { DeliveryTarget, Job, JobSchedule } from '@/scheduler/api'
import type {
  JobToolScope,
  ScopedJobRow,
  ScopedJobStatus,
  ScopedJobStore,
  ScopedNewJob,
  ScopedNewJobSchedule,
} from '@/tools/api'
import { toJobSessionId } from '@/app/job-session'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { ToolError } from '@/core/errors'
import { jobId } from '@/core/ids'
import { advanceCron } from '@/core/utils/cron'
import { SCHEDULER_MAX_JOBS } from '@/tools/api'

// Scoped, not raw: a job belongs to the agent that created it, so an agent can only ever see and
// remove its own. Filtering here rather than in SQL keeps JobStore's shape unaware of tool scopes;
// the job table is bounded by what a human scheduled, so the full read is cheap.
export function createScopedJobStore(app: App): ScopedJobStore {
  const owned = async (scope: JobToolScope): Promise<readonly Job[]> => {
    const jobs = await app.resolve('jobStore').list()

    return jobs.filter((job) => job.agentId === scope.agentId)
  }

  // Replaced, never appended to, so the chain cannot grow; a failed add must not poison the next.
  let tail: Promise<unknown> = Promise.resolve()
  const serialize = <T>(op: () => Promise<T>): Promise<T> => {
    const next = tail.then(op)

    tail = next.catch(() => undefined)

    return next
  }

  return {
    // The cap and duplicate guards read before they write, so adds are serialized: two parallel
    // tool calls would otherwise both pass a cap one short, or both insert the same job.
    add(scope: JobToolScope, input: ScopedNewJob): Promise<ScopedJobRow> {
      return serialize(async () => {
        const jobs = await owned(scope)

        if (jobs.length >= SCHEDULER_MAX_JOBS) {
          throw new ToolError('schedule_blocked', `agent already has ${SCHEDULER_MAX_JOBS} jobs`)
        }

        const dupe = jobs.find(
          (existing) =>
            existing.prompt === input.prompt && isSameSchedule(existing.schedule, input.schedule)
        )

        if (dupe !== undefined) {
          throw new ToolError(
            'schedule_blocked',
            `same prompt and schedule already exist (${dupe.id})`
          )
        }

        const job = buildScopedJob(scope, input)
        const created = await app.resolve('jobStore').create(job)

        if (!created) {
          throw new ToolError('schedule_blocked', `job id collision (${job.id})`)
        }

        return toScopedRow(job, Date.now())
      })
    },

    async list(scope: JobToolScope): Promise<readonly ScopedJobRow[]> {
      const now = Date.now()

      return (await owned(scope)).map((job) => toScopedRow(job, now))
    },

    async resolveIdPrefix(scope: JobToolScope, idOrPrefix: string): Promise<JobId> {
      const matches = (await owned(scope)).filter((job) => job.id.startsWith(idOrPrefix))
      const first = matches[0]

      if (first === undefined) {
        throw new ToolError('invalid_input', `no job matches "${idOrPrefix}"`)
      }

      // An ambiguous prefix is a refusal, never a guess: removing the wrong job is not undoable.
      if (matches.length > 1) {
        throw new ToolError('invalid_input', `"${idOrPrefix}" matches ${matches.length} jobs`)
      }

      return first.id
    },

    async remove(scope: JobToolScope, id: JobId): Promise<void> {
      const found = (await owned(scope)).some((job) => job.id === id)

      if (!found) {
        throw new ToolError('invalid_input', `no job ${id}`)
      }

      await removeThroughScheduler(app, scope, id)
    },
  }
}

// Through the scheduler like every other removal: it stops a run and retires a price job's alert.
// A job that removes itself is inside the run the scheduler would wait for, so that run is left to end.
async function removeThroughScheduler(app: App, scope: JobToolScope, id: JobId): Promise<void> {
  await app
    .resolve('schedulerCommands')
    .removeAny(id, { fromOwnRun: scope.sessionId === toJobSessionId(id) })
}

function toScopedRow(job: Job, now: number): ScopedJobRow {
  return {
    id: job.id,
    status: toJobStatus(job, now),
    prompt: job.prompt,
    ...(job.event === undefined ? { nextRunAt: job.nextRunAt } : { onEvent: job.event.event }),
    ...(job.schedule.kind === 'cron' ? { cronExpr: job.schedule.expr } : {}),
  }
}

// A one-shot is disabled the instant it fires and its run time never moves, so a disabled one that
// is already due has been spent. A recurring job recomputes its next run on resume, so it is only
// ever paused.
function toJobStatus(job: Job, now: number): ScopedJobStatus {
  if (job.enabled) {
    return 'scheduled'
  }

  // An event job's time is never reached; a price one is spent by its single crossing.
  if (job.event !== undefined) {
    return job.event.event === 'price' ? 'done' : 'paused'
  }

  return job.schedule.kind === 'once' && job.nextRunAt <= now ? 'done' : 'paused'
}

// The clock is read once here so the schedule and nextRunAt of one job never disagree.
function buildScopedJob(scope: JobToolScope, input: ScopedNewJob): Job {
  const now = Date.now()
  const schedule = toJobSchedule(input.schedule)
  // Delivery defaults to the chat the job was created in; a local CLI session has no inbound
  // address, so its job falls back to the daemon's default target.
  const target: DeliveryTarget | undefined =
    scope.chatId !== undefined && scope.channel !== LOCAL_CHANNEL_ID
      ? { channel: scope.channel, chatId: scope.chatId }
      : undefined

  return {
    id: jobId(randomUUID()),
    agentId: scope.agentId,
    prompt: input.prompt,
    schedule,
    ...(target === undefined ? {} : { target }),
    enabled: true,
    nextRunAt: firstRunAt(schedule, now),
    consecutiveFailures: 0,
    ...(scope.chatId === undefined
      ? {}
      : { owner: { userId: scope.userId, channel: scope.channel, chatId: scope.chatId } }),
  }
}

function toJobSchedule(schedule: ScopedNewJobSchedule): JobSchedule {
  return schedule.kind === 'cron'
    ? { kind: 'cron', expr: schedule.expr, timezone: schedule.timezone }
    : { kind: 'once', at: schedule.atMs }
}

function firstRunAt(schedule: JobSchedule, now: number): number {
  if (schedule.kind === 'cron') {
    return advanceCron(schedule.expr, new Date(now), schedule.timezone).getTime()
  }

  if (schedule.kind === 'once') {
    return schedule.at
  }

  return now + schedule.everyMs
}

function isSameSchedule(existing: JobSchedule, incoming: ScopedNewJobSchedule): boolean {
  if (existing.kind === 'cron' && incoming.kind === 'cron') {
    return existing.expr === incoming.expr && existing.timezone === incoming.timezone
  }

  return existing.kind === 'once' && incoming.kind === 'once' && existing.at === incoming.atMs
}
