import type { VenueReconciliation } from '@/trading/features/portfolio/folds/reconcile'
import type { PortfolioAtOptions } from '@/trading/features/portfolio/options'
import type { PortfolioViewDeps } from '@/trading/features/portfolio/view'
import type { Position } from '@/trading/kernel/operator/book'
import type { Venue, VenueRegistry } from '@/trading/venues/types'
import { isAbortError } from '@/core/errors'
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
  readonly positions: readonly Position[]
  readonly signal: AbortSignal
}

/** Every registered venue answers, including the ones that cannot be asked. A custodian that failed
 *  this time is reported as unreachable rather than failing the reading the others answered. */
async function reconcileOne(input: ReconcileOneInput): Promise<VenueReconciliation> {
  const { adapter } = input.venue
  const { id: venue, missingCredentials } = input.venue.manifest

  if (missingCredentials !== undefined) {
    return { venue, mismatches: [], uncompared: 'keyless', missingCredentials }
  }

  if (adapter?.fetchBalances === undefined) {
    return { venue, mismatches: [], uncompared: 'unsupported' }
  }

  try {
    const [balances, minimumSizes] = await Promise.all([
      adapter.fetchBalances(input.signal),
      venueMinimumSizes(input.venue, input.signal),
    ])

    return reconcileVenue({
      venue,
      positions: input.positions,
      balances,
      cashAsset: adapter.quoteAsset,
      minimumSizes,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return { venue, mismatches: [], uncompared: 'unreachable' }
  }
}

/** Holds the book against what the custodians actually report. Read-only and venue-by-venue: a
 *  venue the operator trades by hand carries no adapter and has nothing to be held against. */
export async function reconcileBook(
  deps: ReconcileDeps,
  options: PortfolioAtOptions
): Promise<readonly VenueReconciliation[]> {
  const asOf = resolveRegionDay(deps.markets, deps.defaultRegion, options.now)
  const { positions } = await loadBook(deps, { ...options, asOf })
  const { signal } = options

  return Promise.all(deps.venues.list().map((venue) => reconcileOne({ venue, positions, signal })))
}
