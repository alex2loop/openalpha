/** The page's one set of time units, and the calendar step that needs nothing else. */
export const MS_PER_SECOND = 1_000
export const SECONDS_PER_MINUTE = 60
export const MINUTES_PER_HOUR = 60
export const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE
export const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR
export const HOURS_PER_DAY = 24
export const MS_PER_DAY = MS_PER_HOUR * HOURS_PER_DAY
// `YYYY-MM-DD`.
const DAY_KEY_LENGTH = 10

/** The `YYYY-MM-DD` day `days` after (or before) `day`, on the calendar. */
export function shiftDay(day: string, days: number): string {
  const shifted = new Date(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY)

  return shifted.toISOString().slice(0, DAY_KEY_LENGTH)
}
