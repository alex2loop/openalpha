import type { TtlCache } from '@/core/utils/collections'
import { ttlCache } from '@/core/utils/collections'
import { MS_PER_MINUTE } from '@/core/utils/time'

/** A visit reads a feed, a few posts and their comments; thirty a minute is far past that. */
const MAX_READS_PER_MINUTE = 30
/** Agent-network pairs tracked at once; a pair idle for two minutes is dropped. */
const MAX_TRACKED_PAIRS = 1_000

export interface ReadLimiter {
  /** Counts one read; false when this minute's allowance is spent. */
  take(key: string, now: number): boolean
}

/** Reads per minute, in process: a restart starts a fresh minute, which is harmless at this scale.
 *  Daily write caps and the duplicate guard read `social_writes` instead, so they survive one. */
export function createReadLimiter(): ReadLimiter {
  const counts: TtlCache<string, number> = ttlCache(2 * MS_PER_MINUTE, MAX_TRACKED_PAIRS)

  return {
    take(key, now) {
      const bucket = `${key}:${Math.floor(now / MS_PER_MINUTE)}`
      const used = counts.get(bucket) ?? 0

      if (used >= MAX_READS_PER_MINUTE) {
        return false
      }

      counts.set(bucket, used + 1)

      return true
    },
  }
}
