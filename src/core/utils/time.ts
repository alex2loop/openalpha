import { abortError, ValidationError } from '@/core/errors'

export const MS_PER_SECOND = 1_000
export const MS_PER_MINUTE = 60_000
export const MS_PER_HOUR = 3_600_000
export const MS_PER_DAY = 86_400_000
const MS_PER_WEEK = 604_800_000
const MINUTES_PER_HOUR = 60
const DAILY_WINDOW_SEPARATOR = '-'

/** `HH:MM` on a 24-hour clock. One owner for every surface that accepts an operator-entered local
 *  time: a second copy is a second answer to "is 24:00 a time?". */
export const LOCAL_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
// Node/Bun coerce a setTimeout delay at or above 2^31 ms to ~1ms, turning it into a hot loop. Every
// configured duration that reaches a timer is capped here.
export const MAX_TIMER_MS = 2 ** 31 - 1

// Constructing a formatter costs more than the lookups that use it. Unbounded only in the sense
// that the schedule tool lets a caller name a zone: every key clears `toCanonicalTimeZone` first,
// so the space is the IANA set rather than arbitrary text, and it never grows with traffic.
const ZONE_FORMATTERS = new Map<string, Intl.DateTimeFormat>()

const DURATION_RE = /^(\d+)\s*(ms|s|m|h|d|w)$/i
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
// Indexed by a raw regex capture, so the value type carries the `undefined` an unknown unit yields.
const UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: MS_PER_SECOND,
  m: MS_PER_MINUTE,
  h: MS_PER_HOUR,
  d: MS_PER_DAY,
  w: MS_PER_WEEK,
}

interface DurationValue {
  readonly kind: 'value'
  readonly ms: number
}

interface DurationError {
  readonly kind: 'error'
  readonly reason: 'invalid' | 'range'
}

export interface EpochRange {
  readonly fromMs: number
  readonly toMs: number
}

interface ZonedParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

export type DurationResult = DurationValue | DurationError

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError(signal))
  }

  // Defensive clamp: a caller-computed delay (backoff, retry) must never overflow setTimeout's
  // 32-bit delay into a ~1ms hot loop, even if the value bypassed parseDuration's own bound.
  const boundedMs = Math.min(ms, MAX_TIMER_MS)

  return new Promise((resolve, reject) => {
    let handle: ReturnType<typeof setTimeout>

    const onAbort = (): void => {
      clearTimeout(handle)
      reject(abortError(signal))
    }
    handle = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, boundedMs)

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function utcDay(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 10)
}

// A spend cap resets on the operator's calendar, not UTC's: in UTC+7 a UTC day boundary falls at
// 07:00, mid-working-day, so a cap would reset halfway through the session it is meant to bound.
export function dayBoundsInZone(atMs: number, timeZone: string): EpochRange {
  const { year, month, day } = zonedParts(atMs, timeZone)

  return {
    fromMs: zonedStartMs(Date.UTC(year, month - 1, day), timeZone),
    toMs: zonedStartMs(Date.UTC(year, month - 1, day + 1), timeZone),
  }
}

/** The zone's calendar day at an instant, as `YYYY-MM-DD`. */
export function dayInZone(atMs: number, timeZone: string): string {
  const { year, month, day } = zonedParts(atMs, timeZone)

  return utcDay(Date.UTC(year, month - 1, day))
}

/** An inclusive run of the zone's calendar days as a half-open instant range, the same boundary a
 *  spend cap resets on. Undefined for a malformed day. */
export function dayRangeInZone(
  range: { readonly fromDay: string; readonly toDay: string },
  timeZone: string
): EpochRange | undefined {
  const fromWallMs = parseIsoDay(range.fromDay)
  const toWallMs = parseIsoDay(range.toDay)

  if (fromWallMs === undefined || toWallMs === undefined) {
    return undefined
  }

  return {
    fromMs: zonedStartMs(fromWallMs, timeZone),
    toMs: zonedStartMs(toWallMs + MS_PER_DAY, timeZone),
  }
}

export function monthBoundsInZone(atMs: number, timeZone: string): EpochRange {
  const { year, month } = zonedParts(atMs, timeZone)

  return {
    fromMs: zonedStartMs(Date.UTC(year, month - 1, 1), timeZone),
    toMs: zonedStartMs(Date.UTC(year, month, 1), timeZone),
  }
}

/** The zone's canonical spelling, so `utc` and `asia/ho_chi_minh` match what a store compares
 *  against. Throws RangeError for an unknown zone. */
export function toCanonicalTimeZone(timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone
}

// `wallMs` is the target local midnight read as though it were UTC; Date.UTC normalizes an
// out-of-range day or month at the call site, so the callers above roll over for free.
function zonedStartMs(wallMs: number, timeZone: string): number {
  const guess = wallMs - zoneOffsetMs(wallMs, timeZone)

  // The offset that applies at the guess may differ from the one at the wall time across a DST
  // edge; re-probing at the guess settles it.
  return wallMs - zoneOffsetMs(guess, timeZone)
}

// Offset to add to a UTC instant to read it as `timeZone` wall clock.
export function zoneOffsetMs(atMs: number, timeZone: string): number {
  const parts = zonedParts(atMs, timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )

  return asUtc - Math.floor(atMs / MS_PER_SECOND) * MS_PER_SECOND
}

function zonedParts(atMs: number, timeZone: string): ZonedParts {
  const formatted = zoneFormatter(timeZone).formatToParts(new Date(atMs))
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(formatted.find((part) => part.type === type)?.value ?? '0')

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = ZONE_FORMATTERS.get(timeZone)

  if (cached !== undefined) {
    return cached
  }

  // `h23` rather than the default: `h24` reports midnight as hour 24 of the previous day.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  ZONE_FORMATTERS.set(timeZone, formatter)

  return formatter
}

// Strict UTC-day parser: rejects impossible days (2026-02-30) by round-tripping through the
// formatter — Date.parse alone silently rolls them into the next month. Returns the day's
// start epoch-ms.
export function parseIsoDay(value: string): number | undefined {
  if (!ISO_DAY_RE.test(value)) {
    return undefined
  }

  const parsed = Date.parse(`${value}T00:00:00.000Z`)

  if (!Number.isFinite(parsed) || utcDay(parsed) !== value) {
    return undefined
  }

  return parsed
}

export function parseDuration(input: string): DurationResult {
  const match = DURATION_RE.exec(input.trim())

  if (match === null) {
    return { kind: 'error', reason: 'invalid' }
  }

  const amount = Number(match[1])
  const unitMs = UNIT_MS[(match[2] ?? '').toLowerCase()]

  if (unitMs === undefined || amount === 0 || !Number.isSafeInteger(amount)) {
    return { kind: 'error', reason: 'range' }
  }

  const ms = amount * unitMs

  // Not bounded by MAX_TIMER_MS: every caller does timestamp math with the result, and a retention
  // window past 24 days is the ordinary case. `delay` clamps its own argument, so a duration that
  // does reach a timer cannot wrap into a ~1ms hot loop.
  if (!Number.isSafeInteger(ms)) {
    return { kind: 'error', reason: 'range' }
  }

  return { kind: 'value', ms }
}

/** A stretch of every day on one clock. An end before the start crosses midnight. */
export interface DailyWindow {
  readonly startMinute: number
  readonly endMinute: number
  readonly timeZone: string
}

/** `HH:MM-HH:MM` read in `timeZone`. An empty window (start equals end) is refused, because it
 *  reads as "never" to one operator and "always" to another. */
export function parseDailyWindow(raw: string, timeZone: string): DailyWindow {
  const [start = '', end = '', ...rest] = raw
    .split(DAILY_WINDOW_SEPARATOR)
    .map((part) => part.trim())
  const startMinute = minuteOfDay(start)
  const endMinute = minuteOfDay(end)

  if (rest.length > 0 || startMinute === undefined || endMinute === undefined) {
    throw new ValidationError(`'${raw}' is not a daily window such as 07:00-23:00`)
  }

  if (startMinute === endMinute) {
    throw new ValidationError(`'${raw}' starts and ends at the same minute`)
  }

  return { startMinute, endMinute, timeZone: toCanonicalTimeZone(timeZone) }
}

export function isWithinDailyWindow(atMs: number, window: DailyWindow): boolean {
  const localMs = atMs + zoneOffsetMs(atMs, window.timeZone)
  const minute = Math.floor((((localMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / MS_PER_MINUTE)

  if (window.startMinute < window.endMinute) {
    return minute >= window.startMinute && minute < window.endMinute
  }

  return minute >= window.startMinute || minute < window.endMinute
}

function minuteOfDay(raw: string): number | undefined {
  const match = LOCAL_TIME_RE.exec(raw)

  return match === null ? undefined : Number(match[1]) * MINUTES_PER_HOUR + Number(match[2])
}
