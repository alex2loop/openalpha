import type { UpdateWatchlistOptions, WatchlistResult } from '@/trading/features/profile/types'
import type { InstrumentRef, TickerRequest } from '@/trading/kernel/instrument'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { MarketRegistry } from '@/trading/markets/types'
import { resolveInstruments } from '@/trading/features/market-data/resolve'
import { dedupeInstruments } from '@/trading/kernel/instrument'

/** Adding resolves each name so a stored entry always carries the market that owns it; removing
 *  reads the qualifier the operator gave, and a bare name needs no market. Returns the next list
 *  rather than writing it — persistence and its validation belong to the service. */
export async function resolveWatchlist(
  markets: MarketRegistry,
  profile: UserProfile,
  options: UpdateWatchlistOptions
): Promise<WatchlistResult> {
  if (options.kind === 'remove') {
    return {
      kind: 'watchlist',
      instruments: profile.watchlist.filter((entry) => !isDropped(entry, options.tickers)),
      instrumentKinds: new Map(),
    }
  }

  const resolution = await resolveInstruments(markets, options)

  if (resolution.kind === 'unresolved') {
    return resolution
  }

  return {
    kind: 'watchlist',
    instruments: dedupeInstruments([...profile.watchlist, ...resolution.instruments]),
    instrumentKinds: resolution.instrumentKinds,
  }
}

/** A bare ticker drops the name from every market holding it; a qualified one drops that market's
 *  alone, which is the distinction the add side already draws. */
function isDropped(entry: InstrumentRef, requests: readonly TickerRequest[]): boolean {
  return requests.some(
    (request) =>
      request.ticker === entry.ticker &&
      (request.market === undefined || request.market === entry.market)
  )
}
