import { OperatorConfigError } from '@/core/config/operator-errors'

const CRON_WS_RE = /\s+/
const DIGITS_RE = /^\d+$/
const RANGE_RE = /^(\d+)-(\d+)$/
// `*/N` or `lo-hi/N`; the range groups are absent for the `*` form.
const STEP_RE = /^(?:\*|(\d+)-(\d+))\/(\d+)$/
// Vixie cron: `7` in the day-of-week field is an alias for Sunday (0).
const DOW_SUNDAY_ALIAS = 7
const DOW_SUNDAY = 0
const DOW_SATURDAY = 6
const CRON_FIELD_BOUNDS = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
] as const

const MONTH_DAYS: Readonly<Record<number, number>> = {
  1: 31,
  2: 28,
  3: 31,
  4: 30,
  5: 31,
  6: 30,
  7: 31,
  8: 31,
  9: 30,
  10: 31,
  11: 30,
  12: 31,
}

export type CronField =
  | null
  | number
  | { readonly lo: number; readonly hi: number }
  | readonly number[]

type CronBounds = (typeof CRON_FIELD_BOUNDS)[number]

type DayFieldMode = 'restricted' | 'any'

export interface CronFields {
  readonly minute: CronField
  readonly hour: CronField
  readonly day: CronField
  readonly month: CronField
  readonly weekday: CronField
  readonly domMode: DayFieldMode
  readonly dowMode: DayFieldMode
  /** Vixie's split: a pinned wall-clock job runs once across a repeated hour and is made up after a
   *  skipped one; a "wildcard" job (minute or hour field starting with `*`) follows the clock. */
  readonly pinnedTime: boolean
}

export function parseCronExpr(expr: string): CronFields {
  const raw = expr.trim().split(CRON_WS_RE)

  if (raw.length !== 5) {
    throw new OperatorConfigError('expected 5 cron fields', { key: 'errors.cronFieldCount' })
  }

  const minute = parseCronField(raw[0] ?? '', CRON_FIELD_BOUNDS[0])
  const hour = parseCronField(raw[1] ?? '', CRON_FIELD_BOUNDS[1])
  const day = parseCronField(raw[2] ?? '', CRON_FIELD_BOUNDS[2])
  const month = parseCronField(raw[3] ?? '', CRON_FIELD_BOUNDS[3])
  // Vixie cron: 7 is an alias for Sunday (0) in the day-of-week field.
  const weekday = parseCronField(normalizeDowField(raw[4] ?? ''), CRON_FIELD_BOUNDS[4])

  assertDayFitsMonth(day, month)

  return {
    minute,
    hour,
    day,
    month,
    weekday,
    domMode: dayFieldModeOf(raw[2] ?? ''),
    dowMode: dayFieldModeOf(raw[4] ?? ''),
    pinnedTime: !((raw[0] ?? '').startsWith('*') || (raw[1] ?? '').startsWith('*')),
  }
}

// Vixie: a day field whose text starts with `*` is unrestricted even when it steps (`*/2`), so it
// ANDs with the other day field instead of ORing with it.
function dayFieldModeOf(field: string): DayFieldMode {
  return field.startsWith('*') ? 'any' : 'restricted'
}

// Per position, never across the whole field: a blind replace also hits a step's denominator and a
// range's endpoints, where `0-7/2` becomes `0-0/2` and fires on Sunday alone without saying so.
function normalizeDowField(field: string): string {
  return field
    .split(',')
    .map((part) => normalizeDowPart(part.trim()))
    .join(',')
}

function normalizeDowPart(part: string): string {
  const step = STEP_RE.exec(part)

  if (step !== null) {
    // Only the range endpoints carry day values; the denominator is a count.
    return step[1] === undefined || step[2] === undefined
      ? part
      : `${normalizeDowRange(step[1], step[2])}/${step[3]}`
  }

  const range = RANGE_RE.exec(part)

  if (range?.[1] !== undefined && range[2] !== undefined) {
    return normalizeDowRange(range[1], range[2])
  }

  return normalizeDowValue(part)
}

/** `lo-7` spans lo..Saturday plus Sunday: from a non-zero `lo` that is the wrap range `lo-0` the
 *  parser already materializes, and from `0` it is the whole week, which `0-0` would not be. */
function normalizeDowRange(lo: string, hi: string): string {
  if (Number(hi) !== DOW_SUNDAY_ALIAS) {
    return `${normalizeDowValue(lo)}-${hi}`
  }

  return Number(lo) === DOW_SUNDAY ? `${DOW_SUNDAY}-${DOW_SATURDAY}` : `${lo}-${DOW_SUNDAY}`
}

function normalizeDowValue(value: string): string {
  return value === String(DOW_SUNDAY_ALIAS) ? String(DOW_SUNDAY) : value
}

function parseCronField(s: string, bounds: CronBounds): CronField {
  if (s === '*') {
    return null
  }

  const parts = s.split(',').map((part) => part.trim())
  const single = parts.length === 1 ? parts[0] : undefined

  if (single !== undefined && DIGITS_RE.test(single)) {
    const value = Number(single)
    assertCronValueInBounds(s, value, bounds)

    return value
  }

  const range = single === undefined ? null : RANGE_RE.exec(single)

  if (range !== null) {
    return rangeField(parseCronRange(s, range, bounds), bounds)
  }

  const values = new Set<number>()

  for (const part of parts) {
    for (const value of expandCronPart(s, part, bounds)) {
      values.add(value)
    }
  }

  return [...values].sort((a, b) => a - b)
}

// A plain (non-wrap) range keeps the O(1) {lo,hi} shape `isCronFieldMatch` tests directly; a
// wrap-around range (lo > hi, e.g. `22-2` or a weekday `5-1`) has no contiguous lo..hi span, so it
// is materialized into its explicit value list instead.
function rangeField(
  range: { readonly lo: number; readonly hi: number },
  bounds: CronBounds
): CronField {
  return range.lo <= range.hi ? range : rangeValues(range, 1, bounds)
}

function expandCronPart(field: string, part: string, bounds: CronBounds): readonly number[] {
  const step = STEP_RE.exec(part)

  if (step !== null) {
    return expandCronStep(field, step, bounds)
  }

  const range = RANGE_RE.exec(part)

  if (range !== null) {
    return rangeValues(parseCronRange(field, range, bounds), 1, bounds)
  }

  if (!DIGITS_RE.test(part)) {
    throw new OperatorConfigError(
      `'${field}' is unsupported. Supported: *, N, N-M, */N, N-M/N, and lists`,
      { key: 'errors.cronFieldSyntax', params: { field } }
    )
  }

  const value = Number(part)
  assertCronValueInBounds(field, value, bounds)

  return [value]
}

function expandCronStep(
  field: string,
  match: RegExpExecArray,
  bounds: CronBounds
): readonly number[] {
  const [, rangeLo, rangeHi, rawStep] = match
  const step = Number(rawStep)

  if (!Number.isInteger(step) || step < 1) {
    throw new OperatorConfigError(`cron step in '${field}' must be at least 1`, {
      key: 'errors.cronStep',
      params: { field },
    })
  }

  const range = {
    lo: rangeLo === undefined ? bounds.min : Number(rangeLo),
    hi: rangeHi === undefined ? bounds.max : Number(rangeHi),
  }

  assertCronBounds(field, range, bounds)

  return rangeValues(range, step, bounds)
}

// Wrap-around range (lo > hi): expands to two segments joined at the field's bounds, stepping in
// one continuous phase across the wrap rather than restarting the step counter at bounds.min.
function rangeValues(
  range: { readonly lo: number; readonly hi: number },
  step: number,
  bounds: CronBounds
): readonly number[] {
  const { lo, hi } = range

  if (lo <= hi) {
    return stepValues(lo, hi, step)
  }

  const span = bounds.max - lo + 1 + (hi - bounds.min + 1)
  const fieldSize = bounds.max - bounds.min + 1
  const values: number[] = []

  for (let offset = 0; offset < span; offset += step) {
    const value = lo + offset
    values.push(value > bounds.max ? value - fieldSize : value)
  }

  return values
}

function parseCronRange(
  field: string,
  match: RegExpExecArray,
  bounds: CronBounds
): { readonly lo: number; readonly hi: number } {
  const range = { lo: Number(match[1]), hi: Number(match[2]) }
  assertCronBounds(field, range, bounds)

  return range
}

function stepValues(lo: number, hi: number, step: number): readonly number[] {
  const values: number[] = []

  for (let value = lo; value <= hi; value += step) {
    values.push(value)
  }

  return values
}

// lo > hi is not an error: it is a wrap-around range (e.g. `22-2`, or a weekday `5-1` for
// fri-mon), handled by rangeField/rangeValues at the call site.
function assertCronBounds(
  field: string,
  range: { readonly lo: number; readonly hi: number },
  bounds: CronBounds
): void {
  assertCronValueInBounds(field, range.lo, bounds)
  assertCronValueInBounds(field, range.hi, bounds)
}

function assertCronValueInBounds(field: string, value: number, bounds: CronBounds): void {
  if (value < bounds.min || value > bounds.max) {
    throw new OperatorConfigError(
      `cron field '${field}' must be between ${bounds.min} and ${bounds.max}`,
      { key: 'errors.cronFieldRange', params: { field, minimum: bounds.min, maximum: bounds.max } }
    )
  }
}

function assertDayFitsMonth(day: CronField, month: CronField): void {
  if (typeof day !== 'number' || typeof month !== 'number') {
    return
  }

  // Feb 29 is rare but real (leap years) — the search window covers it.
  if (month === 2 && day === 29) {
    return
  }

  const maxDay = MONTH_DAYS[month]

  if (maxDay !== undefined && day > maxDay) {
    throw new OperatorConfigError(`day ${day} never occurs in month ${month} (max ${maxDay})`, {
      key: 'errors.cronDayNever',
      params: { day, month },
    })
  }
}
