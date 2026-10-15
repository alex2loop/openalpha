import type { RateLimiter, RateLimitKey } from '@/engine/types/cost'
import { abortError, RunHalted } from '@/core/errors'
import { RATE_LIMIT_MAX_KEYS, RATE_LIMIT_WINDOW_MS } from '@/engine/constants'

const FAIR_BURST_RATIO = 0.5

interface RateBucket {
  count: number
  windowStart: number
}

export function createRateLimiter(maxPerWindow: number): RateLimiter {
  const globalLimit = normalizeLimit(maxPerWindow)
  const fairLimit = fairBurstLimit(globalLimit)
  const globalBucket: RateBucket = { count: 0, windowStart: 0 }
  const fairBuckets = new Map<string, RateBucket>()

  return {
    async acquire(key: RateLimitKey, signal: AbortSignal): Promise<void> {
      if (signal.aborted) {
        throw abortError(signal)
      }

      const now = Date.now()
      const fairKey = toFairKey(key)
      const currentFairBucket = fairBuckets.get(fairKey)
      const nextGlobalBucket = bucketAt(globalBucket, now)
      const nextFairBucket = bucketAt(currentFairBucket, now)

      if (nextGlobalBucket.count >= globalLimit || nextFairBucket.count >= fairLimit) {
        throw new RunHalted('rate', 'rate limit exceeded')
      }

      globalBucket.count = nextGlobalBucket.count + 1
      globalBucket.windowStart = nextGlobalBucket.windowStart
      nextFairBucket.count += 1
      touchBucket(fairBuckets, fairKey, nextFairBucket)
      evictIfFull(fairBuckets, now)
    },
  }
}

function fairBurstLimit(globalLimit: number): number {
  return Number.isFinite(globalLimit)
    ? Math.max(1, Math.floor(globalLimit * FAIR_BURST_RATIO))
    : Number.POSITIVE_INFINITY
}

function toFairKey(key: RateLimitKey): string {
  return JSON.stringify([key.agentId, key.userId])
}

function bucketAt(bucket: RateBucket | undefined, now: number): RateBucket {
  if (bucket === undefined || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    return { count: 0, windowStart: now }
  }

  return bucket
}

// Absent or nonsensical means uncapped, matching the budget caps. Mapping it to 0 would read as
// "admit nothing" one line below and wedge every run behind a rate-limit halt.
function normalizeLimit(limit: number): number {
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : Number.POSITIVE_INFINITY
}

// Not `lruMap`: eviction here prefers an EXPIRED bucket over the least-recently-used one, which a
// recency-ordered map cannot express. Map iteration is insertion-order, so re-inserting on every
// access moves a bucket to the tail and `keys().next()` still yields the LRU key as the fallback.
function touchBucket(buckets: Map<string, RateBucket>, key: string, bucket: RateBucket): void {
  buckets.delete(key)
  buckets.set(key, bucket)
}

// Prefer an expired bucket so a flood of unique keys cannot reset windows for legitimate callers.
function evictIfFull(buckets: Map<string, RateBucket>, now: number): void {
  if (buckets.size <= RATE_LIMIT_MAX_KEYS) {
    return
  }

  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      buckets.delete(key)
      return
    }
  }

  const oldest = buckets.keys().next().value

  if (oldest !== undefined) {
    buckets.delete(oldest)
  }
}
