import { type Signal, signal } from '@preact/signals'

import type { JobCreateBody, JobEventWire } from '@/app/server/wire/jobs'
import type { TradingQuoteWire } from '@/app/server/wire/trading'
import type { MessageKey } from '@/i18n'
import { findQuote, priceDisplayOf } from '@/web/state/market'
import { buildDayKey, formatClock, shiftDay } from '@/web/text/time'

const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
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
const SEPARATORS = /[.,]/g
const PLAIN_NUMBER = /^\d+(\.\d+)?$/
const SPACES = /\s+/g

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
    isBusy: signal(false),
  }
}

// The typed name with its market and today's price, off the board; absent when the board lacks it.
function findTypedQuote(form: ScheduleForm): TradingQuoteWire | undefined {
  const ticker = form.ticker.value.trim().toUpperCase()

  return ticker === '' ? undefined : findQuote(ticker)
}

/** "125,00", "125.00" or "1.250,5": the last separator is the decimal one unless it repeats; absent
 *  for an empty or non-numeric level. */
function parseLevel(text: string): number | undefined {
  const cleaned = text.replace(SPACES, '')
  const separators = cleaned.match(SEPARATORS) ?? []
  const last = separators.at(-1)
  const isDecimal = last !== undefined && separators.filter((held) => held === last).length === 1
  const index = isDecimal ? cleaned.lastIndexOf(last) : -1
  const whole = (index < 0 ? cleaned : cleaned.slice(0, index)).replace(SEPARATORS, '')
  const plain = index < 0 ? whole : `${whole}.${cleaned.slice(index + 1)}`

  if (!PLAIN_NUMBER.test(plain)) {
    return undefined
  }

  const value = Number(plain)

  return value > 0 ? value : undefined
}

/** The body `POST /v1/jobs` takes; absent when a price level is missing. */
export function buildJobBody(form: ScheduleForm, timeZone: string): JobCreateBody | undefined {
  const schedule = form.mode.value === 'time' ? buildTimed(form, timeZone) : buildEvent(form)

  return schedule === undefined
    ? undefined
    : { agentId: form.agentId, prompt: form.work.value.trim(), schedule }
}

function buildTimed(form: ScheduleForm, timeZone: string): JobCreateBody['schedule'] {
  const [hours = '0', minutes = '0'] = form.runAt.value.split(':')

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
  const level = parseLevel(form.level.value)
  const quote = findTypedQuote(form)

  if (level === undefined) {
    return undefined
  }

  if (quote === undefined) {
    return { threshold: level }
  }

  // The level is typed on the board's scale.
  const threshold = level * (priceDisplayOf(quote.market)?.divisor ?? 1)

  return { threshold, quote, condition: threshold < quote.last ? 'below' : 'above' }
}
