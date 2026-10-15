import type { Logger } from '@/core/logging/logger'
import type { VenueRef } from '@/trading/kernel/instrument'
import type { VenueCatalog, VenueInstrument } from '@/trading/kernel/venue/catalog'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { ttlCache } from '@/core/utils/collections'

/** What a venue lists changes when it lists or delists something, and the exit reconcile asks every
 *  alert tick. An hour is short against the first and long against the second. */
const CATALOG_TTL_MS = 60 * 60 * 1000
const CACHE_KEY = 'instruments'

interface CachedCatalogInput {
  readonly venue: VenueRef
  readonly catalog: VenueCatalog
  readonly logger: Logger
}

/** The instrument list is cached, never the in-flight promise — sharing that would hand one
 *  caller's `AbortSignal` to every other. Prices pass straight through: the screen asks once a run
 *  and a cached price is a price nobody trades at.
 *
 *  A failure after one good answer serves that answer rather than a venue listing nothing, which
 *  reads as "every holding is tradeable and no name is listed": it arms alerts on residue and drops
 *  the venue's names from the screen gate. With no good answer yet the throw carries, because a
 *  catalog nobody has reached must not decide what the operator holds. An empty answer is not
 *  cached, for the reason `listOne` refuses to read one as listed.
 *
 *  Every other read is forwarded by spreading the wrapped catalog rather than by naming it here, so
 *  a read a venue adds later is not dropped silently. A catalog is a plain object built by a
 *  factory, which is what makes the spread carry its methods. */
export function cachingCatalog(input: CachedCatalogInput): VenueCatalog {
  const cache = ttlCache<string, readonly VenueInstrument[]>(CATALOG_TTL_MS, 1)
  let lastGood: readonly VenueInstrument[] | undefined
  let servingStale = false

  return {
    ...input.catalog,

    async listInstruments(signal: AbortSignal): Promise<readonly VenueInstrument[]> {
      const fresh = cache.get(CACHE_KEY)

      if (fresh !== undefined) {
        return fresh
      }

      try {
        const listed = await input.catalog.listInstruments(signal)

        if (listed.length > 0) {
          cache.set(CACHE_KEY, listed)
          lastGood = listed
        }

        servingStale = false

        return listed
      } catch (err: unknown) {
        if (isAbortError(err) || lastGood === undefined) {
          throw err
        }

        // The start of a stale streak, not every tick of one: the reconcile retries each minute and
        // a day of outage would otherwise be a day of identical lines.
        if (!servingStale) {
          input.logger.warn('trading.venue_catalog_stale', {
            venue: input.venue,
            err: formatErrForLog(err),
          })
        }

        servingStale = true

        return lastGood
      }
    },
  }
}
