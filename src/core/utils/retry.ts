import { assertNotAborted } from '@/core/errors'
import { sleep } from '@/core/utils/time'

const RETRY_MAX_ATTEMPTS = 3
const RETRY_BACKOFF_INITIAL_MS = 250
const RETRY_JITTER_FACTOR = 0.25

export const RETRY_MAX_DELAY_MS = 300_000

interface RetryOptions {
  maxAttempts?: number
  initialMs?: number
  maxMs?: number
  signal?: AbortSignal
  isRetryable?: (err: unknown) => boolean
  random?: () => number
  delayFor?: (err: unknown, attempt: number) => number
}

interface BackoffInput {
  readonly attempt: number
  readonly err: unknown
  readonly options: RetryOptions
}

// Exponential backoff over any async operation. Default retries all errors; callers pass
// isRetryable to narrow (e.g. retry only transient network errors).
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  assertNotAborted(options.signal)

  const maxAttempts = Math.max(1, options.maxAttempts ?? RETRY_MAX_ATTEMPTS)
  const isRetryable = options.isRetryable ?? (() => true)

  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      assertNotAborted(options.signal)

      if (!isRetryable(err)) {
        throw err
      }

      await sleep(backoffMs({ attempt, err, options }), options.signal)
    }
  }

  // The last attempt has nothing left to fall back to, so its rejection is the caller's answer.
  return await fn()
}

function backoffMs(input: BackoffInput): number {
  const { attempt, err, options } = input
  const initialMs = Math.max(0, options.initialMs ?? RETRY_BACKOFF_INITIAL_MS)
  const maxMs = Math.max(0, options.maxMs ?? RETRY_MAX_DELAY_MS)
  const random = options.random ?? Math.random
  const exponentialMs = computeBackoffMs(attempt, initialMs, maxMs)
  const randomFraction = Math.min(1, Math.max(0, random()))
  const jitteredMs = exponentialMs * (1 + randomFraction * RETRY_JITTER_FACTOR)
  const serverFloorMs = Math.max(0, options.delayFor?.(err, attempt) ?? 0)

  // The cap bounds our own backoff, never the provider's demand: clamping `Retry-After: 30` to a 5 s
  // ceiling re-sends inside the window it just refused.
  return Math.max(serverFloorMs, Math.min(maxMs, jitteredMs))
}

/** Doubling from `baseMs` per failure after the first, capped: the one backoff curve every retry
 *  policy shares. */
export function computeBackoffMs(failures: number, baseMs: number, capMs: number): number {
  return Math.min(capMs, baseMs * 2 ** Math.max(0, failures - 1))
}
