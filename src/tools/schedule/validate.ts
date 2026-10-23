import { ConfigError, ToolError } from '@/core/errors'
import { hasBlockingThreat, scanOutput } from '@/core/security/sanitize'
import { advanceCron } from '@/core/utils/cron'
import { MS_PER_MINUTE, toCanonicalTimeZone } from '@/core/utils/time'
import { toEpochMs } from '@/tools/schedule/time'

export const SCHEDULER_PROMPT_MAX_BYTES = 10_240
// Cron's own granularity: a shorter interval only spends model calls faster.
const MINIMUM_INTERVAL_MS = MS_PER_MINUTE
// Below this an `at` number is epoch seconds, not milliseconds: as ms it is the year 2001.
const MIN_EPOCH_MS = 1e12
// The last instant a job may be set for (end of year 9999, what a four-digit year can name). Past
// the Date range a saved job could not even be formatted.
const MAX_EPOCH_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999)

// The one owner of what a job may be, for every surface that makes one: the schedule tool, the CLI
// and the API. Each throws `ToolError('invalid_input')` and leaves the wording to its caller.

export function assertJobPrompt(prompt: string): void {
  const promptBytes = Buffer.byteLength(prompt, 'utf8')

  if (promptBytes > SCHEDULER_PROMPT_MAX_BYTES) {
    throw new ToolError(
      'payload_too_large',
      `prompt size ${promptBytes} exceeds cap ${SCHEDULER_PROMPT_MAX_BYTES}`
    )
  }

  if (hasBlockingThreat(scanOutput(prompt))) {
    throw new ToolError('invalid_input', 'cron prompt rejected: injection pattern detected')
  }
}

export function assertKnownAgent<T extends string>(agent: T, has: (agent: T) => boolean): void {
  if (!has(agent)) {
    throw new ToolError('invalid_input', `no agent ${agent}`)
  }
}

export function assertValidCron(expr: string, now: number, tz: string): void {
  try {
    advanceCron(expr, new Date(now), tz)
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      throw new ToolError('invalid_input', `invalid cron expression "${expr}": ${err.message}`)
    }
    throw err
  }
}

export function assertInterval(everyMs: number): void {
  if (!Number.isFinite(everyMs) || everyMs < MINIMUM_INTERVAL_MS) {
    throw new ToolError('invalid_input', `an interval is at least ${MINIMUM_INTERVAL_MS} ms`)
  }
}

// DateTimeFormat accepts IANA links (e.g. Asia/Ho_Chi_Minh) that Intl.supportedValuesOf omits.
export function resolveTimezone(tz: string): string {
  try {
    return toCanonicalTimeZone(tz)
  } catch {
    throw new ToolError('invalid_input', `invalid timezone: ${tz}`)
  }
}

// `now` is taken once by the caller so this check and the stored time agree.
export function resolveOnceAt(at: string | number, tz: string, now: number): number {
  if (typeof at === 'number' && at < MIN_EPOCH_MS) {
    throw new ToolError(
      'invalid_input',
      `${at} looks like epoch seconds - pass milliseconds, or a "YYYY-MM-DD HH:mm" string`
    )
  }

  const atMs = typeof at === 'number' ? at : toEpochMs(at, tz)

  if (!Number.isFinite(atMs) || atMs <= now) {
    throw new ToolError('invalid_input', 'that time is in the past - pick a future date and time')
  }

  if (atMs > MAX_EPOCH_MS) {
    throw new ToolError(
      'invalid_input',
      'that time is too far away - pick a date before year 10000'
    )
  }

  return atMs
}
