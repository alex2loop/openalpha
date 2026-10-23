import { randomUUID } from 'node:crypto'

import type { JobCreateBody, JobEventScheduleBody } from '@/app/server/wire/jobs'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { Job, JobEvent, JobSchedule } from '@/scheduler/api'
import { createAlertRetirer } from '@/app/event-jobs'
import { API_CHANNEL, APP_CHAT_ID } from '@/app/server/channel'
import { apiError, json } from '@/app/server/http/dispatch'
import { JOB_CREATE_BODY, toScheduleRowWire } from '@/app/server/mappers/jobs'
import { hostOf, localeOf, parsePathId, parseTickerRequest } from '@/app/server/routes/params'
import { channelId } from '@/core/channels'
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

type Refused = { readonly refusal: Response }

function invalid(ctx: ApiRouteContext, detail: string): Response {
  return apiError('invalid_body', t(localeOf(ctx), 'errors.jobInvalid', { detail }))
}

async function parseBody(
  req: Request,
  ctx: ApiRouteContext
): Promise<{ readonly body: JobCreateBody } | Refused> {
  const text = await req.text()

  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return { refusal: invalid(ctx, 'the body is too large') }
  }

  let raw: unknown

  try {
    raw = JSON.parse(text)
  } catch {
    return { refusal: apiError('invalid_json') }
  }

  const parsed = JOB_CREATE_BODY.safeParse(raw)

  if (!parsed.success) {
    const issue = parsed.error.issues[0]

    return {
      refusal: invalid(ctx, `${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim()),
    }
  }

  return { body: parsed.data }
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

/** Everything the body can get wrong is checked here, before any alert is armed. A throw is the
 *  caller's input, so it is the operator's 400. */
function buildJob(ctx: ApiRouteContext, body: JobCreateBody): { readonly job: Job } | Refused {
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
      job: {
        id: jobId(randomUUID()),
        agentId: agent,
        prompt: body.prompt,
        schedule: timed.schedule,
        ...(timed.event === undefined ? {} : { event: timed.event }),
        ...(target === undefined ? {} : { target }),
        enabled: true,
        nextRunAt: timed.nextRunAt,
        consecutiveFailures: 0,
      },
    }
  } catch (err: unknown) {
    return { refusal: invalid(ctx, formatErrForLog(err).message) }
  }
}

/** A price job is armed with an alert of its own, which fires to this app. The alert is armed
 *  first and answers for the name it resolved the ticker to. */
async function armPriceAlert(
  req: Request,
  ctx: ApiRouteContext,
  request: { readonly body: JobCreateBody; readonly job: Job }
): Promise<Job | Refused> {
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
    return { refusal: invalid(ctx, 'a price event needs a ticker, a condition and a threshold') }
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
  const parsed = await parseBody(req, ctx)

  if ('refusal' in parsed) {
    return parsed.refusal
  }

  const built = buildJob(ctx, parsed.body)

  if ('refusal' in built) {
    return built.refusal
  }

  const armed = await armPriceAlert(req, ctx, { body: parsed.body, job: built.job })

  return 'refusal' in armed ? armed.refusal : await storeJob(ctx, armed)
}

// The whole id, never a prefix: this is a client's call, and a prefix that names two jobs is a
// guess about which one it meant.
async function findJob(req: Request, ctx: ApiRouteContext, fromEnd: number): Promise<Job | null> {
  const id = parsePathId(req, jobId, fromEnd)

  return id === null ? null : ((await ctx.app.resolve('jobStore').find(id)) ?? null)
}

async function handleDelete(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const job = await findJob(req, ctx, 0)

  if (job === null) {
    return apiError('not_found')
  }

  // Through the scheduler, like the CLI: it stops a run in flight and retires a price job's alert.
  const removed = await ctx.app.resolve('schedulerCommands').removeAny(job.id)

  return removed.kind === 'job' ? json({ ok: true }) : apiError('not_found')
}

async function handlePause(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const job = await findJob(req, ctx, 1)
  const paused =
    job === null ? undefined : await ctx.app.resolve('schedulerCommands').pauseAny(job.id)

  return paused?.kind === 'job' ? json({ ok: true }) : apiError('not_found')
}

async function handleResume(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const job = await findJob(req, ctx, 1)
  const resumed =
    job === null ? undefined : await ctx.app.resolve('schedulerCommands').resumeAny(job.id)

  if (resumed?.kind === 'alert_inactive') {
    return apiError('conflict', t(localeOf(ctx), 'errors.jobAlertGone'))
  }

  return resumed?.kind === 'job' ? json({ ok: true }) : apiError('not_found')
}

/** Answers once the run is admitted to start, not when it ends: a run is minutes long and its
 *  answer reaches the bell. It runs on the daemon's signal, which a client hanging up cannot cancel. */
async function handleRun(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const job = await findJob(req, ctx, 1)

  if (job === null) {
    return apiError('not_found')
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
