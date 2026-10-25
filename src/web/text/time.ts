const MS_PER_SECOND = 1_000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
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

/** A span as `m:ss`, or `h:mm:ss` from an hour up; never below zero. */
export function formatElapsed(spanMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(spanMs / MS_PER_SECOND))
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const minutes = totalMinutes % MINUTES_PER_HOUR
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR)

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
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
