import { MS_PER_MINUTE, MS_PER_SECOND } from '@/core/utils/time'

const DURATION_DECIMAL_PLACES = 1
const SECONDS_PER_MINUTE = MS_PER_MINUTE / MS_PER_SECOND

// Locale is a bare BCP-47 tag so core stays i18n-free; callers pass their Locale, which is a
// string subtype.
export function formatDuration(locale: string, elapsedMs: number): string {
  const boundedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const seconds = boundedMs / MS_PER_SECOND

  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'long',
    minimumFractionDigits: DURATION_DECIMAL_PLACES,
    maximumFractionDigits: DURATION_DECIMAL_PLACES,
  }).format(seconds)
}

export function formatLongDuration(locale: string, elapsedMs: number): string {
  const boundedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0

  if (boundedMs < MS_PER_MINUTE) {
    return formatDuration(locale, boundedMs)
  }

  const totalSeconds = Math.round(boundedMs / MS_PER_SECOND)
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  const minuteText = formatWholeUnit(locale, minutes, 'minute')

  return seconds === 0 ? minuteText : `${minuteText} ${formatWholeUnit(locale, seconds, 'second')}`
}

function formatWholeUnit(locale: string, value: number, unit: 'minute' | 'second'): string {
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(value)
}
