import type { Logger } from '@/core/logging/logger'
import type { InstrumentRef, Ticker } from '@/trading/kernel/instrument'
import type { SpotAdapter } from '@/trading/kernel/venue/spot-adapter'
import type { Venue } from '@/trading/venues/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { instrumentsBySymbol } from '@/trading/venues/holdings'

interface VenueCatalogIndex {
  /** The venue's own symbol to the instrument it names — the exact inverse of `adapter.toSymbol`,
   *  which is what `toTicker` claims to be and cannot be for a venue quoting two markets. */
  readonly bySymbol: ReadonlyMap<string, InstrumentRef>
  readonly tickers: ReadonlySet<Ticker>
}

interface ListingSource {
  readonly venue: Venue
  readonly adapter: SpotAdapter
  readonly logger: Logger
  readonly signal: AbortSignal
}

const EMPTY_CATALOG_INDEX: VenueCatalogIndex = Object.freeze({
  bySymbol: new Map<string, InstrumentRef>(),
  tickers: new Set<Ticker>(),
})

/** What the venue says it carries, read at most once per run. Two readings of one catalog page: the
 *  symbol index every fill is named through, and the ticker set a failed detector falls back to.
 *  A thunk rather than an eager fetch, so a venue publishing no catalog costs nothing. */
export type SyncListing = () => Promise<VenueCatalogIndex>

/** Tolerant by design: every caller has its own path for a symbol this cannot answer, and a catalog
 *  that failed must cost a sync its shortcut rather than its run. */
async function loadListing(input: ListingSource): Promise<VenueCatalogIndex> {
  try {
    const bySymbol = await instrumentsBySymbol(input.venue, input.adapter, input.signal)

    return {
      bySymbol,
      tickers: new Set([...bySymbol.values()].map((instrument) => instrument.ticker)),
    }
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    input.logger.warn('ledger.sync_catalog_unavailable', {
      venue: input.venue.manifest.id,
      err: formatErrForLog(err),
    })

    return EMPTY_CATALOG_INDEX
  }
}

export function listingOnce(input: ListingSource): SyncListing {
  let pending: Promise<VenueCatalogIndex> | undefined

  return () => {
    pending ??= loadListing(input)

    return pending
  }
}
