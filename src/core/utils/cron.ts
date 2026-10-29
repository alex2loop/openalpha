import type { CronField, CronFields } from '@/core/utils/cron-fields'
import { ConfigError } from '@/core/errors'
import { lruMap } from '@/core/utils/collections'
import { parseCronExpr } from '@/core/utils/cron-fields'
import { MS_PER_MINUTE } from '@/core/utils/time'

// Consecutive Feb-29s are up to 8 years apart around a non-leap century year; 9y headroom.
const MAX_SEARCH_YEARS = 9
const MAX_SEARCH_MINUTES = MAX_SEARCH_YEARS * 366 * 24 * 60
const FORMATTER_CACHE_MAX = 256
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 1440
// A named-zone boundary is aimed at from local parts, then re-probed: one correction absorbs a DST
// shift landing us either side of it, a second absorbs a shift inside the correction itself.
const TZ_BOUNDARY_CORRECTIONS = 2
// Wider than any clock change in the tz database, so a transition that put a minute into its
// repeat is always inside the window it is measured over.
const MAX_CLOCK_SHIFT_MINUTES = 180
const formatterCache = lruMap<string, Intl.DateTimeFormat>(FORMATTER_CACHE_MAX)

const WEEKDAY_LOOKUP: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

interface CronParts {
  readonly minute: number
  readonly hour: number
  readonly day: number
  readonly month: number
  readonly weekday: number
}

interface AdvanceState {
  readonly cursor: number
  readonly date: Date
  readonly parts: CronParts
}

type MinuteResult =
  | { readonly kind: 'match'; readonly date: Date }
  | { readonly kind: 'skip'; readonly nextCursor: number }

/** A cron slot answered more than `graceMs` after its clock time is work for a session that has
 *  passed. The one lateness policy: the scheduler and the workflow trigger both ask it. */
export function isSlotLate(slotAt: number, now: number, graceMs: number): boolean {
  return now - slotAt > graceMs
}

// Find the first minute strictly after the minute containing `from` that satisfies the 5-field
// cron expression.
// `tz` omitted/UTC enables fast minute-stepping; a named tz forces Intl part extraction per minute.
export function advanceCron(expr: string, from: Date, tz?: string): Date {
  const fields = parseCronExpr(expr)

  const start = Math.floor(from.getTime() / MS_PER_MINUTE) + 1

  // Bounded by the window searched, not by how many probes it takes: an expression that can never
  // match (`0 0 30,31 2 *` — a day field a list hides from `assertDayFitsMonth`) skips a month at a
  // time, so counting probes instead would grind through hundreds of thousands of years first.
  for (let cursor = start; cursor - start < MAX_SEARCH_MINUTES; cursor++) {
    const hit = tryMinute(cursor, fields, tz)

    if (hit.kind === 'match') {
      return hit.date
    }

    cursor = hit.nextCursor
  }

  throw new ConfigError(`no match within ${MAX_SEARCH_YEARS} years for "${expr}"`)
}

// Test one minute against all five fields. Returns either a match or the next minute-count to
// try (skipping ahead by month/day/hour when the field cannot match this cycle).
function tryMinute(cursor: number, fields: CronFields, tz?: string): MinuteResult {
  const date = new Date(cursor * MS_PER_MINUTE)
  const parts = partsInTz(date, tz)
  const state: AdvanceState = { cursor, date, parts }

  if (isGapCatchUp(fields, state, tz)) {
    return { kind: 'match', date }
  }

  if (!isCronFieldMatch(fields.month, parts.month)) {
    return { kind: 'skip', nextCursor: advanceMonth(state, tz) }
  }
  if (!isDayMatch(fields, parts)) {
    return { kind: 'skip', nextCursor: advanceDay(state, tz) }
  }
  if (!isCronFieldMatch(fields.hour, parts.hour)) {
    return { kind: 'skip', nextCursor: advanceHour(state, tz) }
  }
  if (isCronFieldMatch(fields.minute, parts.minute)) {
    return isSecondPass(fields, state, tz)
      ? { kind: 'skip', nextCursor: cursor }
      : { kind: 'match', date }
  }

  return { kind: 'skip', nextCursor: cursor }
}

// Local clock changes, per Vixie: a pinned time in an hour the clock repeats fires once, on its
// first pass, and one in an hour the clock skips fires at the first minute that exists afterwards.
// Wildcard jobs follow the clock as it runs, so neither rule applies to them.
function isDstAware(fields: CronFields, tz?: string): tz is string {
  return fields.pinnedTime && tz !== undefined && tz !== '' && tz !== 'UTC'
}

// The second time the local clock reads this minute: one clock-shift earlier it read the same.
function isSecondPass(fields: CronFields, state: AdvanceState, tz?: string): boolean {
  if (!isDstAware(fields, tz)) {
    return false
  }

  const before = partsIntl(minutesBefore(state.cursor, MAX_CLOCK_SHIFT_MINUTES), tz)
  const shift = clockShift(before, state.parts, MAX_CLOCK_SHIFT_MINUTES)

  if (shift >= 0) {
    return false
  }

  const first = partsIntl(minutesBefore(state.cursor, -shift), tz)

  return first.hour === state.parts.hour && first.minute === state.parts.minute
}

// This minute is the first after a skipped stretch of local time, and the stretch held a minute
// the expression names.
function isGapCatchUp(fields: CronFields, state: AdvanceState, tz?: string): boolean {
  if (!isDstAware(fields, tz)) {
    return false
  }

  const previous = partsIntl(minutesBefore(state.cursor, 1), tz)
  const skipped = clockShift(previous, state.parts, 1)

  for (let step = 1; step <= skipped; step++) {
    const wall = wallMinutes(previous) + step
    // Past local midnight the skipped minutes belong to the new date.
    const date = wall >= MINUTES_PER_DAY ? state.parts : previous
    const at = {
      ...date,
      hour: Math.floor((wall % MINUTES_PER_DAY) / MINUTES_PER_HOUR),
      minute: wall % MINUTES_PER_HOUR,
    }

    if (isWallMatch(fields, at)) {
      return true
    }
  }

  return false
}

function isWallMatch(fields: CronFields, parts: CronParts): boolean {
  return (
    isCronFieldMatch(fields.month, parts.month) &&
    isDayMatch(fields, parts) &&
    isCronFieldMatch(fields.hour, parts.hour) &&
    isCronFieldMatch(fields.minute, parts.minute)
  )
}

// Wall-clock minutes the local clock moved beyond the real minutes elapsed between two instants:
// positive across a skipped stretch, negative across a repeated one. Compared modulo a day, which
// is enough because the instants are at most `MAX_CLOCK_SHIFT_MINUTES` apart.
function clockShift(earlier: CronParts, later: CronParts, elapsedMinutes: number): number {
  const wrapped =
    (((wallMinutes(later) - wallMinutes(earlier) - elapsedMinutes) % MINUTES_PER_DAY) +
      MINUTES_PER_DAY) %
    MINUTES_PER_DAY

  return wrapped > MINUTES_PER_DAY / 2 ? wrapped - MINUTES_PER_DAY : wrapped
}

function minutesBefore(cursor: number, minutes: number): Date {
  return new Date((cursor - minutes) * MS_PER_MINUTE)
}

// POSIX/Vixie: when both DOM and DOW are restricted, either match fires; otherwise both must match.
function isDayMatch(fields: CronFields, parts: CronParts): boolean {
  const domMatch = isCronFieldMatch(fields.day, parts.day)
  const dowMatch = isCronFieldMatch(fields.weekday, parts.weekday)

  return fields.domMode === 'restricted' && fields.dowMode === 'restricted'
    ? domMatch || dowMatch
    : domMatch && dowMatch
}

// Each advance* jumps to the last minute before the next boundary; the loop's ++ lands on it.
// A named zone skips a day at a time: a month boundary is always at least one local day away, and
// re-deriving it per day costs a handful of Intl probes instead of a month of minute-stepping.
function advanceMonth(state: AdvanceState, tz?: string): number {
  if (tz) {
    return advanceDay(state, tz)
  }

  const next = new Date(state.date)
  next.setUTCMonth(next.getUTCMonth() + 1, 1)
  next.setUTCHours(0, 0, 0, 0)

  return minuteBefore(next)
}

function advanceDay(state: AdvanceState, tz?: string): number {
  if (tz) {
    return nextLocalBoundary(state, tz, MINUTES_PER_DAY)
  }

  const next = new Date(state.date)
  next.setUTCDate(next.getUTCDate() + 1)
  next.setUTCHours(0, 0, 0, 0)

  return minuteBefore(next)
}

function advanceHour(state: AdvanceState, tz?: string): number {
  if (tz) {
    return nextLocalBoundary(state, tz, MINUTES_PER_HOUR)
  }

  const next = new Date(state.date)
  next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0)

  return minuteBefore(next)
}

// Last minute before the next local hour/day boundary. The aim is computed from local parts, then
// re-probed: a DST shift inside the span lands us either side of the boundary, and the correction
// walks back to it. Landing on or before the boundary is what makes the skip safe — every minute
// skipped is inside the span whose field already failed, so none of them can match. A correction
// that fails to converge falls back to minute-stepping rather than risking an overshoot.
function nextLocalBoundary(state: AdvanceState, tz: string, spanMinutes: number): number {
  let target = state.cursor + (spanMinutes - localMinutesInto(state.parts, spanMinutes))

  for (let i = 0; i < TZ_BOUNDARY_CORRECTIONS; i++) {
    const drift = localMinutesInto(partsIntl(new Date(target * MS_PER_MINUTE), tz), spanMinutes)

    if (drift === 0) {
      return target > state.cursor ? target - 1 : state.cursor
    }

    target += drift * 2 <= spanMinutes ? -drift : spanMinutes - drift
  }

  return state.cursor
}

function wallMinutes(parts: CronParts): number {
  return parts.hour * MINUTES_PER_HOUR + parts.minute
}

function localMinutesInto(parts: CronParts, spanMinutes: number): number {
  return wallMinutes(parts) % spanMinutes
}

function minuteBefore(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_MINUTE) - 1
}

function partsInTz(date: Date, tz?: string): CronParts {
  if (!tz || tz === 'UTC') {
    return partsUtc(date)
  }

  return partsIntl(date, tz)
}

function partsUtc(date: Date): CronParts {
  return {
    minute: date.getUTCMinutes(),
    hour: date.getUTCHours(),
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    weekday: date.getUTCDay(),
  }
}

function partsIntl(date: Date, tz: string): CronParts {
  const fmt = getFormatter(tz)
  const parts: Record<string, string> = {}

  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') {
      parts[p.type] = p.value
    }
  }

  const weekdayStr = requirePart(parts, 'weekday')
  const weekdayNum = WEEKDAY_LOOKUP[weekdayStr]

  if (weekdayNum === undefined) {
    throw new ConfigError(`cron: unknown weekday '${weekdayStr}' from Intl`)
  }

  return {
    minute: parseIntlPart(parts, 'minute'),
    // Intl with hour12:false can emit '24' at midnight (h24 vs h23 cycle); normalize to 0.
    hour: parseIntlPart(parts, 'hour') % 24,
    day: parseIntlPart(parts, 'day'),
    month: parseIntlPart(parts, 'month'),
    weekday: weekdayNum,
  }
}

function getFormatter(tz: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(tz)

  if (cached) {
    return cached
  }

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  })
  formatterCache.set(tz, fmt)

  return fmt
}

function requirePart(parts: Record<string, string>, type: string): string {
  const value = parts[type]

  if (value === undefined) {
    throw new ConfigError(`cron: Intl part '${type}' missing in locale output`)
  }

  return value
}

function parseIntlPart(parts: Record<string, string>, type: string): number {
  const n = Number(requirePart(parts, type))

  if (Number.isNaN(n)) {
    throw new ConfigError(`cron: Intl part '${type}' is non-numeric: '${parts[type]}'`)
  }

  return n
}

function isCronFieldMatch(f: CronField, v: number): boolean {
  if (f === null) {
    return true
  }

  if (typeof f === 'number') {
    return f === v
  }

  // `in` (not Array.isArray) because isArray cannot narrow `readonly number[]` out of a union.
  if ('lo' in f) {
    return v >= f.lo && v <= f.hi
  }

  return f.includes(v)
}
