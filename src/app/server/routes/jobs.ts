import { randomUUID } from 'node:crypto'

import type { JobCreateBody, JobEventScheduleBody } from '@/app/server/wire/jobs'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { Job, JobEvent, JobSchedule } from '@/scheduler/api'
import { createAlertRetirer } from '@/app/event-jobs'
import { API_CHANNEL, APP_CHAT_ID } from '@/app/server/channel'
import { apiError, json } from '@/app/server/http/dispatch'
import { JOB_CREATE_BODY, toScheduleRowWire } from '@/app/server/mappers/jobs'
import {
  fieldRefusal,
  hostOf,
  localeOf,
  parsePathId,
  parseTickerRequest,
  readJsonBody,
  toBodyFieldLabel,
} from '@/app/server/routes/params'
import { channelId } from '@/core/channels'
import { operatorMessageOf, ValidationError } from '@/core/errors'
import { toFieldValidationError } from '@/core/field-errors'
import { agentId, jobId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { advanceCron } from '@/core/utils/cron'
import { t } from '@/i18n'
import { EVENT_JOB_PARKED_AT } from '@/scheduler/api'
import {
  assertInterval,
  assertJobPrompt,
  assertKnownAgent,
  assertValidCron,
  resolveOnceAt,
  resolveTimezone,
} from '@/tools/api'

const MAX_BODY_BYTES = 32 * 1024

async function parseBody(req: Request): Promise<JobCreateBody> {
  const parsed = JOB_CREATE_BODY.safeParse(await readJsonBody(req, MAX_BODY_BYTES))

  if (!parsed.success) {
    throw toFieldValidationError(parsed.error, 'job', toBodyFieldLabel)
  }

  return parsed.data
}

interface TimedSchedule {
  readonly schedule: JobSchedule
  readonly nextRunAt: number
  readonly event?: JobEvent
}

function toTimedSchedule(
  ctx: ApiRouteContext,
  schedule: Exclude<JobCreateBody['schedule'], JobEventScheduleBody>,
  now: number
): TimedSchedule {
  if (schedule.kind === 'interval') {
    assertInterval(schedule.everyMs)

    return {
      schedule: { kind: 'interval', everyMs: schedule.everyMs },
      nextRunAt: now + schedule.everyMs,
    }
  }

  const zone = ctx.app.config.locale.timezone

  if (schedule.kind === 'once') {
    const at = resolveOnceAt(schedule.at, zone, now)

    return { schedule: { kind: 'once', at }, nextRunAt: at }
  }

  const timezone = resolveTimezone(schedule.timezone ?? zone)

  assertValidCron(schedule.expr, now, timezone)

  return {
    schedule: { kind: 'cron', expr: schedule.expr, timezone },
    nextRunAt: advanceCron(schedule.expr, new Date(now), timezone).getTime(),
  }
}

// An event job is a `once` job parked where the tick never finds it; the alert wakes it.
function toEventSchedule(schedule: JobEventScheduleBody): TimedSchedule {
  return {
    schedule: { kind: 'once', at: EVENT_JOB_PARKED_AT },
    nextRunAt: EVENT_JOB_PARKED_AT,
    event: {
      event: schedule.event,
      ...(schedule.market === undefined ? {} : { market: schedule.market }),
      ...(schedule.ticker === undefined ? {} : { ticker: schedule.ticker }),
      ...(schedule.condition === undefined ? {} : { condition: schedule.condition }),
      ...(schedule.threshold === undefined ? {} : { threshold: schedule.threshold }),
      cooldownMs: schedule.cooldownMs,
    },
  }
}

/** Everything the body can get wrong is checked here, before any alert is armed. A refusal the
 *  operator can fix leaves as a `ValidationError`, which the route table answers as a 400; anything
 *  else is ours and stays a 500. */
function buildJob(ctx: ApiRouteContext, body: JobCreateBody): Job {
  try {
    const agent = agentId(body.agentId)
    const now = Date.now()

    assertJobPrompt(body.prompt)
    assertKnownAgent(agent, (id) => ctx.app.resolve('agents').has(id))

    const timed: TimedSchedule =
      body.schedule.kind === 'event'
        ? toEventSchedule(body.schedule)
        : toTimedSchedule(ctx, body.schedule, now)
    const target =
      body.target === undefined
        ? undefined
        : { channel: channelId(body.target.channel), chatId: body.target.chatId }

    return {
      id: jobId(randomUUID()),
      agentId: agent,
      prompt: body.prompt,
      schedule: timed.schedule,
      ...(timed.event === undefined ? {} : { event: timed.event }),
      ...(target === undefined ? {} : { target }),
      enabled: true,
      nextRunAt: timed.nextRunAt,
      consecutiveFailures: 0,
    }
  } catch (err: unknown) {
    const operator = operatorMessageOf(err)

    if (operator === undefined) {
      throw err
    }

    throw new ValidationError(formatErrForLog(err).message, operator)
  }
}

/** A price job is armed with an alert of its own, which fires to this app. The alert is armed
 *  first and answers for the name it resolved the ticker to. */
async function armPriceAlert(
  req: Request,
  ctx: ApiRouteContext,
  request: { readonly body: JobCreateBody; readonly job: Job }
): Promise<Job> {
  const { schedule } = request.body
  const { event } = request.job

  if (event?.event !== 'price' || schedule.kind !== 'event') {
    return request.job
  }

  const instrument = parseTickerRequest({
    ticker: event.ticker ?? '',
    ...(event.market === undefined ? {} : { market: event.market }),
  })

  if (instrument === null || event.condition === undefined || event.threshold === undefined) {
    // The body schema cannot judge a ticker or market: that needs the registered markets.
    throw fieldRefusal('schedule.ticker', 'invalid_type')
  }

  const alert = await hostOf(ctx).createAlert({
    instrument,
    condition: event.condition,
    threshold: event.threshold,
    delivery: { channel: API_CHANNEL, chatId: APP_CHAT_ID },
    requireNew: true,
    ...(schedule.typedPrice === undefined ? {} : { typedPrice: schedule.typedPrice }),
    signal: req.signal,
  })

  return {
    ...request.job,
    event: {
      ...event,
      market: alert.instrument.market,
      ticker: alert.instrument.ticker,
      alertId: alert.id,
    },
  }
}

// The alert of a job that never got written. It is disabled on the daemon's signal, not the
// request's: a client that hung up must not leave the alert armed.
async function disarmAlert(ctx: ApiRouteContext, job: Job): Promise<void> {
  const armed = job.event?.alertId

  if (armed === undefined) {
    return
  }

  try {
    await createAlertRetirer(ctx.app)(armed)
  } catch (err: unknown) {
    ctx.app.resolve('logger').warn('api.job_alert_disable_failed', {
      jobId: job.id,
      err: formatErrForLog(err),
    })
  }
}

async function storeJob(ctx: ApiRouteContext, job: Job): Promise<Response> {
  let created = false

  try {
    created = await ctx.app.resolve('jobStore').create(job)
  } catch (err: unknown) {
    await disarmAlert(ctx, job)

    throw err
  }

  if (!created) {
    await disarmAlert(ctx, job)

    return apiError('conflict')
  }

  return json(toScheduleRowWire(job))
}

async function handleCreate(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const body = await parseBody(req)
  const armed = await armPriceAlert(req, ctx, { body, job: buildJob(ctx, body) })

  return await storeJob(ctx, armed)
}

// The whole id, never a prefix: this is a client's call, and a prefix that names two jobs is a
// guess about which one it meant. A malformed id is the caller's mistake, an unknown one is absent.
async function findJob(
  req: Request,
  ctx: ApiRouteContext,
  fromEnd: number
): Promise<Job | Response> {
  const id = parsePathId(req, jobId, fromEnd)

  if (id === null) {
    return apiError('invalid_body')
  }

  return (await ctx.app.resolve('jobStore').find(id)) ?? apiError('not_found')
}

async function handleDelete(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const job = await findJob(req, ctx, 0)

  if (job instanceof Response) {
    return job
  }

  // Through the scheduler, like the CLI: it stops a run in flight and retires a price job's alert.
  const removed = await ctx.app.resolve('schedulerCommands').removeAny(job.id)

  return removed.kind === 'job' ? json({ ok: true }) : apiError('not_found')
}

async function handlePause(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const job = await findJob(req, ctx, 1)

  if (job instanceof Response) {
    return job
  }

  const paused = await ctx.app.resolve('schedulerCommands').pauseAny(job.id)

  return paused.kind === 'job' ? json({ ok: true }) : apiError('not_found')
}

async function handleResume(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const job = await findJob(req, ctx, 1)

  if (job instanceof Response) {
    return job
  }

  const resumed = await ctx.app.resolve('schedulerCommands').resumeAny(job.id)

  if (resumed.kind === 'alert_inactive') {
    return apiError('conflict', t(localeOf(ctx), 'errors.jobAlertGone'))
  }

  return resumed.kind === 'job' ? json({ ok: true }) : apiError('not_found')
}

/** Answers once the run is admitted to start, not when it ends: a run is minutes long and its
 *  answer reaches the bell. It runs on the daemon's signal, which a client hanging up cannot cancel. */
async function handleRun(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const job = await findJob(req, ctx, 1)

  if (job instanceof Response) {
    return job
  }

  if (!job.enabled) {
    return apiError('conflict')
  }

  const logger = ctx.app.resolve('logger')

  ctx.app
    .resolve('schedulerCommands')
    .runNow({ idOrPrefix: job.id, requestId: randomUUID(), signal: ctx.app.signal })
    .catch((err: unknown) => {
      logger.warn('api.job_run_failed', { jobId: job.id, err: formatErrForLog(err) })
    })

  return json({ ok: true }, 202)
}

export const JOB_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'POST', path: '/v1/jobs', auth: true, handler: handleCreate },
  { method: 'DELETE', path: '/v1/jobs/:id', auth: true, handler: handleDelete },
  { method: 'POST', path: '/v1/jobs/:id/pause', auth: true, handler: handlePause },
  { method: 'POST', path: '/v1/jobs/:id/resume', auth: true, handler: handleResume },
  { method: 'POST', path: '/v1/jobs/:id/run', auth: true, handler: handleRun },
]
