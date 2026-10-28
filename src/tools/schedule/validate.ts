import type { OperatorMessage } from '@/core/errors'
import { ConfigError, operatorMessageOf } from '@/core/errors'
import { hasBlockingThreat, scanOutput } from '@/core/security/sanitize'
import { advanceCron } from '@/core/utils/cron'
import { MS_PER_MINUTE, toCanonicalTimeZone } from '@/core/utils/time'
import { JobInputError } from '@/tools/schedule/job-input-error'
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
// and the API. Each refusal is a `JobInputError`: English for the agent, a keyed sentence for the
// operator.

interface PromptIssue {
  readonly code: 'payload_too_large' | 'invalid_input'
  readonly message: string
  readonly operator: OperatorMessage
}

/** What is wrong with a prompt, first problem only; empty when it may run. */
export function validateJobPrompt(prompt: string): readonly PromptIssue[] {
  const promptBytes = Buffer.byteLength(prompt, 'utf8')

  if (promptBytes > SCHEDULER_PROMPT_MAX_BYTES) {
    return [
      {
        code: 'payload_too_large',
        message: `prompt size ${promptBytes} exceeds cap ${SCHEDULER_PROMPT_MAX_BYTES}`,
        operator: {
          key: 'errors.jobPromptTooLarge',
          params: { bytes: promptBytes, limit: SCHEDULER_PROMPT_MAX_BYTES },
        },
      },
    ]
  }

  return hasBlockingThreat(scanOutput(prompt))
    ? [
        {
          code: 'invalid_input',
          message: 'cron prompt rejected: injection pattern detected',
          operator: { key: 'errors.jobPromptBlocked' },
        },
      ]
    : []
}

export function assertJobPrompt(prompt: string): void {
  const [issue] = validateJobPrompt(prompt)

  if (issue !== undefined) {
    throw new JobInputError(issue.code, issue.message, issue.operator)
  }
}

export function assertKnownAgent<T extends string>(agent: T, has: (agent: T) => boolean): void {
  if (!has(agent)) {
    throw new JobInputError('invalid_input', `no agent ${agent}`, {
      key: 'errors.jobAgentUnknown',
      params: { agent },
    })
  }
}

export function assertValidCron(expr: string, now: number, tz: string): void {
  try {
    advanceCron(expr, new Date(now), tz)
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      throw new JobInputError(
        'invalid_input',
        `invalid cron expression "${expr}": ${err.message}`,
        operatorMessageOf(err) ?? { key: 'errors.jobCronNever', params: { expr } }
      )
    }

    throw err
  }
}

export function isValidInterval(everyMs: number): boolean {
  return Number.isFinite(everyMs) && everyMs >= MINIMUM_INTERVAL_MS
}

export function assertInterval(everyMs: number): void {
  if (!isValidInterval(everyMs)) {
    throw new JobInputError('invalid_input', `an interval is at least ${MINIMUM_INTERVAL_MS} ms`, {
      key: 'errors.jobIntervalShort',
    })
  }
}

// DateTimeFormat accepts IANA links (e.g. Asia/Ho_Chi_Minh) that Intl.supportedValuesOf omits.
export function resolveTimezone(tz: string): string {
  try {
    return toCanonicalTimeZone(tz)
  } catch {
    throw new JobInputError('invalid_input', `invalid timezone: ${tz}`, {
      key: 'errors.jobTimezoneInvalid',
      params: { timezone: tz },
    })
  }
}

// `now` is taken once by the caller so this check and the stored time agree.
export function resolveOnceAt(at: string | number, tz: string, now: number): number {
  if (typeof at === 'number' && at < MIN_EPOCH_MS) {
    throw new JobInputError(
      'invalid_input',
      `${at} looks like epoch seconds - pass milliseconds, or a "YYYY-MM-DD HH:mm" string`,
      { key: 'errors.jobAtEpochSeconds', params: { at } }
    )
  }

  const atMs = typeof at === 'number' ? at : toEpochMs(at, tz)

  if (!Number.isFinite(atMs) || atMs <= now) {
    throw new JobInputError(
      'invalid_input',
      'that time is in the past - pick a future date and time',
      { key: 'errors.jobAtPast' }
    )
  }

  if (atMs > MAX_EPOCH_MS) {
    throw new JobInputError(
      'invalid_input',
      'that time is too far away - pick a date before year 10000',
      { key: 'errors.jobAtTooFar' }
    )
  }

  return atMs
}
