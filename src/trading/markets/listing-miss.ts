import type { Caveat } from '@/trading/kernel/caveat'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketDetection } from '@/trading/markets/detection'
import type { MarketResolution, ResolveMarketOptions } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { marketRef } from '@/trading/kernel/instrument'

export const UNIVERSE_EMPTY = 'market-data.universe-empty'

/** Waits for a market's first load to land its listing, within a budget, and returns what that
 *  load had to say. */
export type EnsureListing = (market: MarketRef, signal: AbortSignal) => Promise<readonly Caveat[]>

/** A miss over a stored listing: a real check when the listing is populated, a cold or failed
 *  refresh when it is empty. Asked only on the miss path, so a resolved ticker never pays for it.
 *  The empty case names its market, so an operator read knows which listing to load. */
export async function detectListingMiss(
  deps: MarketDeps,
  market: MarketRef,
  signal: AbortSignal
): Promise<MarketDetection> {
  const populated = await deps.marketDataStore.hasInstruments({ market, signal })

  return populated
    ? { kind: 'no-match', listingChecked: true }
    : { kind: 'no-match', caveats: [{ code: UNIVERSE_EMPTY, detail: { market } }] }
}

/** A read the operator typed that found a stored market's listing empty waits once for that market's
 *  first load, then asks again: a fresh install answers the first name typed. The wait ends when the
 *  load's first kind lands, which is the listing in both stock markets, or at the load's budget. A
 *  write never waits, and a stored-only ask never fetches. What the load said rides along when the
 *  name still does not resolve, so a slow or failed load reads as one. */
export async function resolveAfterListingLoad(
  ensureListing: EnsureListing,
  options: ResolveMarketOptions,
  resolveOnce: () => Promise<MarketResolution>
): Promise<MarketResolution> {
  const first = await resolveOnce()
  const empty = emptyListingsOf(first)

  const mayFetch = options.operatorRead === true && options.detection !== 'stored'

  if (!mayFetch || first.kind === 'resolved' || empty.length === 0) {
    return first
  }

  const notes = await ensureListingsQuietly(ensureListing, empty, options.signal)
  const second = await resolveOnce()

  return second.kind === 'resolved' || notes.length === 0
    ? second
    : { ...second, caveats: [...second.caveats, ...notes] }
}

function emptyListingsOf(resolution: MarketResolution): readonly MarketRef[] {
  const markets = resolution.caveats.flatMap((caveat) => {
    const market = caveat.detail?.market

    return caveat.code === UNIVERSE_EMPTY && typeof market === 'string' ? [marketRef(market)] : []
  })

  return [...new Set(markets)]
}

// A load that failed already logged why where it ran; the read answers from what is stored, and one
// market's failed load never costs another's note.
async function ensureListingsQuietly(
  ensureListing: EnsureListing,
  markets: readonly MarketRef[],
  signal: AbortSignal
): Promise<readonly Caveat[]> {
  const settled = await Promise.allSettled(markets.map((market) => ensureListing(market, signal)))
  const notes: Caveat[] = []

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      notes.push(...result.value)
    } else if (signal.aborted || isAbortError(result.reason)) {
      throw result.reason
    }
  }

  return notes
}
