import { MS_PER_HOUR, MS_PER_MINUTE, zoneOffsetMs } from '@/core/utils/time'
import { JobInputError } from '@/tools/schedule/job-input-error'

const LOCAL_DT_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/

interface WallClock {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

// "YYYY-MM-DD HH:mm[:ss]" → epoch ms. A trailing Z or ±HH:mm names the instant outright; without
// one the text is wall clock in `tz`.
export function toEpochMs(local: string, tz: string): number {
  const m = LOCAL_DT_RE.exec(local.trim())

  if (m === null) {
    throw new JobInputError(
      'invalid_input',
      `could not read the time "${local}" - use "YYYY-MM-DD HH:mm" (e.g. "2026-08-05 15:45")`,
      { key: 'errors.jobAtUnreadable', params: { value: local } }
    )
  }

  const offset = m[7]
  const parts: WallClock = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] === undefined ? 0 : Number(m[6]),
  }
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )

  assertRealWallClock(local, wall, parts)

  if (offset !== undefined) {
    return wall - toOffsetMs(offset)
  }

  // Two passes: the offset belongs to the instant the wall time denotes, not to the wall time read
  // as UTC. One pass is an hour out anywhere within the offset's width of a DST transition.
  const instant = wall - zoneOffsetMs(wall - zoneOffsetMs(wall, tz), tz)

  // Spring-forward deletes an hour of wall time, and no instant reads back as 02:30 where clocks
  // jump 02:00 to 03:00 — the passes land an hour early instead of failing. Reading the instant
  // back in the zone is the only way to see it.
  if (instant + zoneOffsetMs(instant, tz) !== wall) {
    throw new JobInputError(
      'invalid_input',
      `"${local}" does not exist in ${tz} - clocks move forward over that time`,
      { key: 'errors.jobAtSkipped', params: { value: local, timezone: tz } }
    )
  }

  return instant
}

export function formatNextRun(epochMs: number, tz: string): string {
  // h23, not hour12:false: the h24 cycle renders midnight as 24:00 and reads as the wrong day.
  const stamp = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(epochMs)

  return `${stamp} (${tz})`
}

// Computed rather than handed to Date.parse, which rolls "2026-02-31" forward to March 3 instead
// of refusing it — a real job on a date the operator never named.
function toOffsetMs(offset: string): number {
  if (offset === 'Z') {
    return 0
  }

  // LOCAL_DT_RE has already pinned the shape to [+-]HH[:]MM, so this is exactly four digits.
  const digits = offset.slice(1).replace(':', '')
  const magnitude =
    Number(digits.slice(0, 2)) * MS_PER_HOUR + Number(digits.slice(2)) * MS_PER_MINUTE

  return offset.startsWith('-') ? -magnitude : magnitude
}

// Date.UTC rolls an out-of-range field into the next unit, so "2026-13-01" becomes 2027-01-01 and
// "2026-02-31" becomes March 3. Round-tripping the components turns both into a refusal.
function assertRealWallClock(local: string, wall: number, parts: WallClock): void {
  const at = new Date(wall)
  const rolled =
    at.getUTCFullYear() !== parts.year ||
    at.getUTCMonth() + 1 !== parts.month ||
    at.getUTCDate() !== parts.day ||
    at.getUTCHours() !== parts.hour ||
    at.getUTCMinutes() !== parts.minute ||
    at.getUTCSeconds() !== parts.second

  if (rolled) {
    throw new JobInputError('invalid_input', `"${local}" is not a real date and time`, {
      key: 'errors.jobAtNotReal',
      params: { value: local },
    })
  }
}
