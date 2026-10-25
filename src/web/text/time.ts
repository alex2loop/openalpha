import { pluralKey } from '@/i18n'
import { tr } from '@/web/text/tr'

/** The page's one set of time units. */
export const MS_PER_SECOND = 1_000
const SECONDS_PER_MINUTE = 60
export const MINUTES_PER_HOUR = 60
export const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE
const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR
// A 24-hour clock reads the same in both page languages.
const CLOCK_LOCALE = 'en-GB'
const CLOCK_PARTS: Intl.DateTimeFormatOptions = Object.freeze({
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const DAY_PARTS: Intl.DateTimeFormatOptions = Object.freeze({
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// One formatter per option set, rebuilt only when the zone changes, so neither grows.
let clockFormatter: { readonly zone: string; readonly format: Intl.DateTimeFormat } | undefined
let dayFormatter: { readonly zone: string; readonly format: Intl.DateTimeFormat } | undefined

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

/** A cadence in its largest whole unit: "12 giờ", "30 phút", "45 giây". */
export function formatDuration(spanMs: number): string {
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
  if (dayFormatter?.zone !== timeZone) {
    dayFormatter = { zone: timeZone, format: buildFormatter(DAY_PARTS, timeZone) }
  }

  const parts = dayFormatter.format.formatToParts(atMs)
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  return `${read('year')}-${read('month')}-${read('day')}`
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
