import type { SourceId } from '@/trading/kernel/source/source-id'
import { ConfigError } from '@/core/errors'
import { MS_PER_MINUTE } from '@/core/utils/time'

/** Share of the minute's budget a bucket may hold at once. A bucket that starts and refills to the
 *  full minute lets a cold process spend the whole allowance in one instant, which a provider
 *  metering a shorter window refuses however well the per-minute figure is respected. What a bucket
 *  earns is unchanged, so sustained throughput is the declared rate; only the burst is capped. */
const BURST_FRACTION = 0.25

export interface Pacer {
  acquire(sourceId: SourceId, signal: AbortSignal): Promise<'ok' | 'aborted'>
}

interface TokenBucket {
  tokens: number
  readonly capacityPerMinute: number
  readonly burstCapacity: number
  lastRefillAt: number
}

/** One continuously-refilling bucket per provider that declared a limit, so a burst is allowed up
 *  to a share of the minute's budget. No declared limit means unpaced, not zero. `clock` is monotonic: refill
 *  is an elapsed-time measurement, and an NTP step would grant negative or inflated tokens. */
export function createPacer(
  rateLimits: Readonly<Partial<Record<SourceId, number>>>,
  clock: () => number = () => performance.now()
): Pacer {
  const buckets = new Map<SourceId, TokenBucket>()

  for (const [id, perMinute] of Object.entries(rateLimits)) {
    if (perMinute !== undefined) {
      // A limit of zero is a configuration mistake, not "block every request": the wait formula
      // divides by `capacityPerMinute` and a zero denominator becomes an Infinity wait, which
      // `setTimeout` clamps to fire immediately — silently unpaced instead of never granted.
      if (perMinute <= 0) {
        throw new ConfigError(`rate limit for source "${id}" must be a positive number per minute`)
      }

      // why-safe: the rate-limit record is keyed by SourceId; Object.entries widens the key.
      buckets.set(id as SourceId, buildBucket(perMinute, clock))
    }
  }

  return {
    async acquire(sourceId, signal) {
      const bucket = buckets.get(sourceId)

      if (!bucket) {
        return 'ok'
      }

      // The wait shares the caller's deadline, so a paced call that would exceed it fails fast.
      return waitForToken(bucket, signal, clock)
    },
  }
}

function buildBucket(capacityPerMinute: number, clock: () => number): TokenBucket {
  // At least one, so a provider limited to under four a minute is paced rather than made to wait
  // for a token it should have started with.
  const burstCapacity = Math.max(1, capacityPerMinute * BURST_FRACTION)

  return { tokens: burstCapacity, capacityPerMinute, burstCapacity, lastRefillAt: clock() }
}

// Continuous refill makes the wait computable, so no poll interval is needed. A waiting caller
// reserves its token before arming the timer, which gives concurrent callers distinct due times.
// An already-aborted signal resolves before arming anything; abort refunds the reservation.
function waitForToken(
  bucket: TokenBucket,
  signal: AbortSignal,
  clock: () => number
): Promise<'ok' | 'aborted'> {
  refill(bucket, clock)

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1

    return Promise.resolve('ok')
  }

  if (signal.aborted) {
    return Promise.resolve('aborted')
  }

  const waitMs = (1 - bucket.tokens) * (MS_PER_MINUTE / bucket.capacityPerMinute)
  bucket.tokens -= 1

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      refill(bucket, clock)
      resolve('ok')
    }, waitMs)

    function onAbort(): void {
      clearTimeout(timer)
      refill(bucket, clock)
      bucket.tokens = Math.min(bucket.burstCapacity, bucket.tokens + 1)
      resolve('aborted')
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function refill(bucket: TokenBucket, clock: () => number): void {
  const nowMs = clock()
  const elapsedMs = nowMs - bucket.lastRefillAt

  bucket.tokens = Math.min(
    bucket.burstCapacity,
    bucket.tokens + elapsedMs * (bucket.capacityPerMinute / MS_PER_MINUTE)
  )
  bucket.lastRefillAt = nowMs
}
