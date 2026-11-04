import type { TtlCache } from '@/core/utils/collections'
import type { SourceKind, SourceResult } from '@/trading/kernel/source/source-result'
import { ttlCache } from '@/core/utils/collections'
import { MS_PER_HOUR, MS_PER_MINUTE } from '@/core/utils/time'
import { SOURCE_KINDS } from '@/trading/kernel/source/source-result'

/** Funding, open interest and the long-short ratio move on exchange cycles, not per poll. */
const FUNDING_MAX_AGE_MS = 15 * MS_PER_MINUTE
/** The fear and greed index is published once a day. */
const SENTIMENT_MAX_AGE_MS = 3 * MS_PER_HOUR
/** The COT report is published once a week. */
const POSITIONING_MAX_AGE_MS = 6 * MS_PER_HOUR
/** A quote is left out on purpose: the live reading is what the page's own poll renews. */
const SOURCE_MAX_AGE_MS: Readonly<Partial<Record<SourceKind, number>>> = Object.freeze({
  funding: FUNDING_MAX_AGE_MS,
  sentiment: SENTIMENT_MAX_AGE_MS,
  positioning: POSITIONING_MAX_AGE_MS,
})
/** One entry per request a surface can vary: funding is read per instrument. */
const MAX_ENTRIES_PER_KIND = 64

interface FreshSlot {
  readonly kind: SourceKind
  /** Names the whole request, so two contexts never share an answer. */
  readonly key: string
  readonly signal: AbortSignal
}

interface FreshReads {
  read<R extends SourceResult<unknown>>(slot: FreshSlot, run: () => Promise<R>): Promise<R>
}

/** Serves a slow-moving kind from its last answer for its max age, so a surface that polls does not
 *  ask the provider on every poll. Only an available answer is kept: a failure is retried by the
 *  next read, and a read whose caller aborted may have been cut short, so it is never kept. Each
 *  kind not named in `SOURCE_MAX_AGE_MS` passes straight through. */
export function createFreshReads(): FreshReads {
  const caches = new Map<SourceKind, TtlCache<string, SourceResult<unknown>>>(
    SOURCE_KINDS.flatMap((kind) => {
      const maxAgeMs = SOURCE_MAX_AGE_MS[kind]

      return maxAgeMs === undefined
        ? []
        : [[kind, ttlCache<string, SourceResult<unknown>>(maxAgeMs, MAX_ENTRIES_PER_KIND)] as const]
    })
  )

  return {
    async read<R extends SourceResult<unknown>>(
      slot: FreshSlot,
      run: () => Promise<R>
    ): Promise<R> {
      const cache = caches.get(slot.kind)
      const hit = cache?.get(slot.key)

      if (hit !== undefined) {
        // why-safe: the key names the request, and one request settles to one result type.
        return hit as R
      }

      const result = await run()

      if (cache !== undefined && result.kind === 'available' && !slot.signal.aborted) {
        cache.set(slot.key, result)
      }

      return result
    },
  }
}
