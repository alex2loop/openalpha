import type { VenueReconciliation } from '@/trading/features/portfolio/folds/reconcile'
import type { PortfolioAtOptions } from '@/trading/features/portfolio/options'
import type { PortfolioViewDeps } from '@/trading/features/portfolio/view'
import type { Book } from '@/trading/kernel/operator/book'
import type { Venue, VenueRegistry } from '@/trading/venues/types'
import { isAbortError } from '@/core/errors'
import { canSyncFills } from '@/trading/features/ledger/sync-run'
import { resolveRegionDay } from '@/trading/features/market-data/resolve'
import { reconcileVenue } from '@/trading/features/portfolio/folds/reconcile'
import { loadBook } from '@/trading/features/portfolio/view'
import { venueMinimumSizes } from '@/trading/venues/holdings'

interface ReconcileDeps extends PortfolioViewDeps {
  readonly venues: VenueRegistry
  readonly defaultRegion: PortfolioViewDeps['config']['defaultRegion']
}

interface ReconcileOneInput {
  readonly venue: Venue
  readonly book: Book
  readonly signal: AbortSignal
}

/** Every registered venue answers, including the ones that cannot be asked. A custodian that failed
 *  this time is reported as unreachable rather than failing the reading the others answered. */
async function reconcileOne(input: ReconcileOneInput): Promise<VenueReconciliation> {
  const { adapter } = input.venue
  const { id: venue, missingCredentials } = input.venue.manifest
  const canSync = canSyncFills(input.venue)

  if (missingCredentials !== undefined) {
    return { venue, mismatches: [], uncompared: 'keyless', missingCredentials, canSync }
  }

  if (adapter?.fetchBalances === undefined) {
    return { venue, mismatches: [], uncompared: 'unsupported', canSync }
  }

  try {
    const [balances, minimumSizes] = await Promise.all([
      adapter.fetchBalances(input.signal),
      venueMinimumSizes(input.venue, input.signal),
    ])

    return reconcileVenue({
      venue,
      positions: input.book.positions,
      balances,
      cashAsset: adapter.quoteAsset,
      bookedCash: input.book.currencyCash.find(
        (cash) => cash.venue === venue && cash.currency === adapter.quoteAsset
      )?.amount,
      minimumSizes,
      canSync,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return { venue, mismatches: [], uncompared: 'unreachable', canSync }
  }
}

/** Holds the book against what the custodians actually report. Read-only and venue-by-venue: a
 *  venue the operator trades by hand carries no adapter and has nothing to be held against. */
export async function reconcileBook(
  deps: ReconcileDeps,
  options: PortfolioAtOptions
): Promise<readonly VenueReconciliation[]> {
  const asOf = resolveRegionDay(deps.markets, deps.defaultRegion, options.now)
  const book = await loadBook(deps, { ...options, asOf })
  const { signal } = options

  return Promise.all(deps.venues.list().map((venue) => reconcileOne({ venue, book, signal })))
}
