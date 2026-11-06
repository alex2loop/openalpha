// Vietnam has no daylight saving, so its calendar day is the UTC clock plus a fixed offset.
const VN_UTC_OFFSET_MS = 25_200_000
const DAY_LENGTH = 'YYYY-MM-DD'.length

/** The Vietnam calendar day, `YYYY-MM-DD`, at `now` (epoch ms), whatever the phone's own zone. */
export function vnToday(now: number): string {
  return new Date(now + VN_UTC_OFFSET_MS).toISOString().slice(0, DAY_LENGTH)
}

/** A `YYYY-MM-DD` day as both languages read it, day first: `06/11/2026`. */
export function formatDay(day: string): string {
  return day.split('-').reverse().join('/')
}
