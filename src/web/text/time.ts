import { formatDay, pluralKey } from '@/i18n'
import { locale } from '@/web/state/session'
import {
  MINUTES_PER_HOUR,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from '@/web/text/time-units'
import { tr } from '@/web/text/tr'

// A 24-hour clock reads the same in both page languages.
const CLOCK_LOCALE = 'en-GB'
const CLOCK_PARTS: Intl.DateTimeFormatOptions = Object.freeze({
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
// Read in the fixed locale too, so the weekday names below always match.
const ZONE_PARTS: Intl.DateTimeFormatOptions = Object.freeze({
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})
const WEEKDAYS: readonly string[] = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
// The page reads one or two zones (the operator's and the home market's); a few spare slots cover a
// changed setting without letting the cache grow.
const MAX_ZONE_FORMATTERS = 4

/** An instant as one zone counts it: `day` is `YYYY-MM-DD`, `minute` the minutes since that day's
 *  midnight (fractional), `dow` 0 for Sunday. */
export interface ClockParts {
  readonly day: string
  readonly minute: number
  readonly dow: number
}

// The clock formatter is rebuilt only when the zone changes, so it never grows.
let clockFormatter: { readonly zone: string; readonly format: Intl.DateTimeFormat } | undefined
const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

/** Whole seconds left until `untilMs`, rounded up and never below zero. */
export function formatCountdown(untilMs: number, nowMs: number): string {
  return String(Math.max(0, Math.ceil((untilMs - nowMs) / MS_PER_SECOND)))
}

/** `HH:mm` of an instant in `timeZone`, the daemon's `[locale] timezone`. */
export function formatClock(atMs: number, timeZone: string): string {
  if (clockFormatter?.zone !== timeZone) {
    clockFormatter = { zone: timeZone, format: buildFormatter(CLOCK_PARTS, timeZone) }
  }

  return clockFormatter.format.format(atMs)
}

/** Today reads as a clock; another day leads with its date. */
export function formatWhen(atMs: number, timeZone: string): string {
  const day = buildDayKey(atMs, timeZone)
  const clock = formatClock(atMs, timeZone)

  return day === buildDayKey(Date.now(), timeZone)
    ? clock
    : tr('ui.office.jobs.dayClock', { day: formatDay(locale.value, day), clock })
}

/** An hour of the day (fractional) as `HH:mm`. */
export function formatHourOfDay(hour: number): string {
  const totalMinutes = Math.round(hour * MINUTES_PER_HOUR)

  return `${pad(Math.floor(totalMinutes / MINUTES_PER_HOUR))}:${pad(totalMinutes % MINUTES_PER_HOUR)}`
}

/** A span as `m:ss`, or `h:mm:ss` from an hour up; never below zero. */
export function formatElapsed(spanMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(spanMs / MS_PER_SECOND))
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const minutes = totalMinutes % MINUTES_PER_HOUR
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR)

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/** A cadence in its largest whole unit: "12 giờ", "30 phút", "45 giây"; under a second, "dưới 1
 *  giây". */
export function formatDuration(spanMs: number): string {
  if (spanMs > 0 && spanMs < MS_PER_SECOND) {
    return tr('ui.office.time.underSecond')
  }

  if (spanMs >= MS_PER_HOUR && spanMs % MS_PER_HOUR === 0) {
    const count = spanMs / MS_PER_HOUR

    return tr(pluralKey(count, 'ui.office.time.hoursOne', 'ui.office.time.hours'), { count })
  }

  if (spanMs >= MS_PER_MINUTE && spanMs % MS_PER_MINUTE === 0) {
    const count = spanMs / MS_PER_MINUTE

    return tr(pluralKey(count, 'ui.office.time.minutesOne', 'ui.office.time.minutes'), { count })
  }

  const count = Math.max(0, Math.round(spanMs / MS_PER_SECOND))

  return tr(pluralKey(count, 'ui.office.time.secondsOne', 'ui.office.time.seconds'), { count })
}

/** The `YYYY-MM-DD` day an instant falls on in `timeZone`, as the daemon counts its days. */
export function buildDayKey(atMs: number, timeZone: string): string {
  return zoneParts(atMs, timeZone).day
}

/** Where `epochMs` falls in `timeZone`; a zone this browser does not know reads in its own zone. */
export function zoneParts(epochMs: number, timeZone: string): ClockParts {
  const parts = resolveZoneFormatter(timeZone).formatToParts(epochMs)
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  const minute =
    Number(read('hour')) * MINUTES_PER_HOUR +
    Number(read('minute')) +
    Number(read('second')) / SECONDS_PER_MINUTE +
    (epochMs % MS_PER_SECOND) / MS_PER_MINUTE

  return {
    day: `${read('year')}-${read('month')}-${read('day')}`,
    minute,
    dow: Math.max(0, WEEKDAYS.indexOf(read('weekday'))),
  }
}

function resolveZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const held = zoneFormatters.get(timeZone)

  if (held !== undefined) {
    return held
  }

  const oldest = zoneFormatters.keys().next()

  if (zoneFormatters.size >= MAX_ZONE_FORMATTERS && oldest.done !== true) {
    zoneFormatters.delete(oldest.value)
  }

  const format = buildFormatter(ZONE_PARTS, timeZone)

  zoneFormatters.set(timeZone, format)

  return format
}

// A zone this browser does not know reads in the browser's own zone rather than failing the page.
function buildFormatter(parts: Intl.DateTimeFormatOptions, timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(CLOCK_LOCALE, { ...parts, timeZone })
  } catch {
    return new Intl.DateTimeFormat(CLOCK_LOCALE, parts)
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
