import { z } from 'zod'

import type { JobCreateBody, JobEventWire } from '@/app/server/wire/jobs'
import type { ScheduleRow } from '@/app/server/wire/system'
import type { Job, JobEvent } from '@/scheduler/api'
import { MIN_EVENT_COOLDOWN_MS } from '@/app/server/wire/jobs'
import { TYPED_PRICES } from '@/trading/api'

const MAX_TEXT_CHARS = 200

const EVENT_SCHEDULE = z
  .object({
    kind: z.literal('event'),
    event: z.enum(['stop', 'target', 'price', 'mover']),
    market: z.string().min(1).max(MAX_TEXT_CHARS).exactOptional(),
    ticker: z.string().min(1).max(MAX_TEXT_CHARS).exactOptional(),
    condition: z.enum(['above', 'below']).exactOptional(),
    threshold: z.number().positive().exactOptional(),
    typedPrice: z.enum(TYPED_PRICES).exactOptional(),
    cooldownMs: z.number().int().min(MIN_EVENT_COOLDOWN_MS),
  })
  .superRefine((schedule, ctx) => {
    const isPrice = schedule.event === 'price'
    const hasLevel = schedule.condition !== undefined && schedule.threshold !== undefined

    // A price job is armed with an alert of its own, so it names the name and the level; the
    // others follow alerts that already exist and carry no level of their own.
    if (isPrice && !(schedule.ticker !== undefined && hasLevel)) {
      ctx.addIssue({
        code: 'custom',
        message: 'a price event needs ticker, condition and threshold',
        params: { kind: 'price_event_incomplete' },
      })
    }

    const levelled =
      schedule.condition !== undefined ||
      schedule.threshold !== undefined ||
      schedule.typedPrice !== undefined

    if (!isPrice && levelled) {
      ctx.addIssue({
        code: 'custom',
        message: 'only a price event takes a level',
        params: { kind: 'level_not_price' },
      })
    }
  })

export const JOB_CREATE_BODY: z.ZodType<JobCreateBody> = z.object({
  agentId: z.string().min(1).max(MAX_TEXT_CHARS),
  prompt: z.string().min(1),
  schedule: z.union([
    z.object({
      kind: z.literal('cron'),
      expr: z.string().min(1).max(MAX_TEXT_CHARS),
      timezone: z.string().min(1).max(MAX_TEXT_CHARS).exactOptional(),
    }),
    z.object({ kind: z.literal('interval'), everyMs: z.number().int().positive() }),
    z.object({
      kind: z.literal('once'),
      at: z.union([z.string().min(1).max(MAX_TEXT_CHARS), z.number().int().positive()]),
    }),
    EVENT_SCHEDULE,
  ]),
  target: z
    .object({
      channel: z.string().min(1).max(MAX_TEXT_CHARS),
      chatId: z.string().min(1).max(MAX_TEXT_CHARS),
    })
    .exactOptional(),
})

function toEventWire(event: JobEvent): JobEventWire {
  return {
    event: event.event,
    ...(event.market === undefined ? {} : { market: event.market }),
    ...(event.ticker === undefined ? {} : { ticker: event.ticker }),
    ...(event.condition === undefined ? {} : { condition: event.condition }),
    ...(event.threshold === undefined ? {} : { threshold: event.threshold }),
    cooldownMs: event.cooldownMs,
  }
}

/** The scheduler's row, passed through as it always was, except an event job: its stored time is a
 *  parking slot that no client may read, so it goes out with `event` and without `schedule` or
 *  `nextRunAt`. */
export function toScheduleRowWire(job: Job): ScheduleRow {
  const { event, nextRunAt: _nextRunAt, schedule: _schedule, ...rest } = job

  return event === undefined ? { ...job } : { ...rest, event: toEventWire(event) }
}
