import { type Signal, signal } from '@preact/signals'

import type { JobCreateBody, JobEventWire } from '@/app/server/wire/jobs'
import type { TradingQuoteWire } from '@/app/server/wire/trading'
import type { MessageKey } from '@/i18n'
import { findQuote, priceDisplayOf } from '@/web/state/market'
import { toDecimal } from '@/web/text/decimal'
import { buildDayKey, formatClock } from '@/web/text/time'
import { MS_PER_HOUR, MS_PER_MINUTE, shiftDay } from '@/web/text/time-units'

const COOLDOWN_SHORT_MS = 30 * MS_PER_MINUTE
const COOLDOWN_MEDIUM_MS = 2 * MS_PER_HOUR
const COOLDOWN_DAY_MS = 24 * MS_PER_HOUR
/** The waits the dialog offers between two runs for one name; the daemon takes any from its minimum. */
export const EVENT_COOLDOWNS: readonly { readonly ms: number; readonly label: MessageKey }[] = [
  { ms: COOLDOWN_SHORT_MS, label: 'ui.office.schedule.cooldown30m' },
  { ms: COOLDOWN_MEDIUM_MS, label: 'ui.office.schedule.cooldown2h' },
  { ms: COOLDOWN_DAY_MS, label: 'ui.office.schedule.cooldown1d' },
]
// The time a new timed schedule starts at, before the operator picks one.
const DEFAULT_RUN_AT = '09:00'
// Cron days of week: the working week, and Monday.
const CRON_TRADING_DAYS = '1-5'
const CRON_MONDAY = '1'
// A whole time of day, `HH:mm` on a 24-hour clock.
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export type EventKind = JobEventWire['event']
export type Repeat = 'daily' | 'weekly' | 'once'

export const REPEAT_LABELS = Object.freeze({
  daily: 'ui.office.schedule.daily',
  weekly: 'ui.office.schedule.weekly',
  once: 'ui.office.schedule.once',
} as const satisfies Record<Repeat, MessageKey>)

/** Exhaustive by `satisfies`, in the order the dialog lists them. */
// why-safe: the object's keys are exactly `EventKind`, checked by `satisfies`.
export const EVENT_KINDS = Object.keys({
  stop: true,
  target: true,
  price: true,
  mover: true,
} satisfies Record<EventKind, true>) as readonly EventKind[]

/** One open schedule dialog: what the operator set so far. */
export interface ScheduleForm {
  readonly agentId: string
  readonly mode: Signal<'time' | 'event'>
  readonly runAt: Signal<string>
  readonly repeat: Signal<Repeat>
  readonly event: Signal<EventKind>
  readonly ticker: Signal<string>
  readonly level: Signal<string>
  readonly cooldownMs: Signal<number>
  readonly work: Signal<string>
  readonly failure: Signal<string | undefined>
  /** The daemon's sentence for each field it refused, by the path it named. */
  readonly fields: Signal<ReadonlyMap<string, string>>
  readonly isBusy: Signal<boolean>
}

export function createScheduleForm(agentId: string): ScheduleForm {
  return {
    agentId,
    mode: signal('time'),
    runAt: signal(DEFAULT_RUN_AT),
    repeat: signal('daily'),
    event: signal(EVENT_KINDS[0] ?? 'stop'),
    ticker: signal(''),
    level: signal(''),
    cooldownMs: signal(COOLDOWN_SHORT_MS),
    work: signal(''),
    failure: signal(undefined),
    fields: signal(new Map()),
    isBusy: signal(false),
  }
}

// The typed name with its market and today's price, off the board; absent when the board lacks it.
function findTypedQuote(form: ScheduleForm): TradingQuoteWire | undefined {
  const ticker = form.ticker.value.trim().toUpperCase()

  return ticker === '' ? undefined : findQuote(ticker)
}

/** The body `POST /v1/jobs` takes; absent when the run time or a price level is missing. */
export function buildJobBody(form: ScheduleForm, timeZone: string): JobCreateBody | undefined {
  const schedule = form.mode.value === 'time' ? buildTimed(form, timeZone) : buildEvent(form)

  return schedule === undefined
    ? undefined
    : { agentId: form.agentId, prompt: form.work.value.trim(), schedule }
}

/** A cleared or half-typed time input is no time: it must never fall back to midnight. */
export function isRunAtSet(form: ScheduleForm): boolean {
  return CLOCK_TIME.test(form.runAt.value)
}

function buildTimed(form: ScheduleForm, timeZone: string): JobCreateBody['schedule'] | undefined {
  if (!isRunAtSet(form)) {
    return undefined
  }

  const [hours = '', minutes = ''] = form.runAt.value.split(':')

  switch (form.repeat.value) {
    case 'daily':
      return { kind: 'cron', expr: `${Number(minutes)} ${Number(hours)} * * ${CRON_TRADING_DAYS}` }
    case 'weekly':
      return { kind: 'cron', expr: `${Number(minutes)} ${Number(hours)} * * ${CRON_MONDAY}` }
    case 'once':
      return {
        kind: 'once',
        at: `${resolveOnceDay(form.runAt.value, timeZone)} ${form.runAt.value}`,
      }
  }
}

// Today when the time is still ahead on the daemon's clock, else tomorrow.
function resolveOnceDay(runAt: string, timeZone: string): string {
  const now = Date.now()
  const today = buildDayKey(now, timeZone)

  return runAt > formatClock(now, timeZone) ? today : shiftDay(today, 1)
}

function buildEvent(form: ScheduleForm): JobCreateBody['schedule'] | undefined {
  const ticker = form.ticker.value.trim().toUpperCase()
  const base = {
    kind: 'event' as const,
    event: form.event.value,
    cooldownMs: form.cooldownMs.value,
    ...(ticker === '' ? {} : { ticker }),
  }

  if (form.event.value !== 'price') {
    return base
  }

  const trigger = resolvePriceTrigger(form)

  if (trigger === undefined) {
    return undefined
  }

  const { quote, threshold, condition } = trigger

  return {
    ...base,
    threshold,
    ...(quote === undefined ? {} : { market: quote.market }),
    ...(condition === undefined ? {} : { condition }),
  }
}

interface PriceTrigger {
  readonly threshold: number
  /** The name on the board, which sets the scale and today's price. */
  readonly quote?: TradingQuoteWire
  /** "vượt" a level above today's price, "thủng" one below it; absent off the board. */
  readonly condition?: 'above' | 'below'
}

/** The typed level on the daemon's scale, and the side of today's price it sits on; absent for an
 *  empty or non-numeric level. */
export function resolvePriceTrigger(form: ScheduleForm): PriceTrigger | undefined {
  const level = toDecimal(form.level.value)
  const quote = findTypedQuote(form)

  if (level === undefined || level <= 0) {
    return undefined
  }

  if (quote === undefined) {
    return { threshold: level }
  }

  // The level is typed on the board's scale.
  const threshold = level * (priceDisplayOf(quote.market)?.divisor ?? 1)

  return { threshold, quote, condition: threshold < quote.last ? 'below' : 'above' }
}
