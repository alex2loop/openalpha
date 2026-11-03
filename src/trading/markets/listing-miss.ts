import type { MarketRef } from '@/trading/kernel/instrument'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketDetection } from '@/trading/markets/detection'

/** A miss over a stored listing: a real check when the listing is populated, a cold or failed
 *  refresh when it is empty. Asked only on the miss path, so a resolved ticker never pays for it. */
export async function detectListingMiss(
  deps: MarketDeps,
  market: MarketRef,
  signal: AbortSignal
): Promise<MarketDetection> {
  const populated = await deps.marketDataStore.hasInstruments({ market, signal })

  return populated
    ? { kind: 'no-match', listingChecked: true }
    : { kind: 'no-match', caveats: [{ code: 'market-data.universe-empty' }] }
}
