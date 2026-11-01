import type { DefaultVenues } from '@/trading/kernel/config'
import type { MarketRef, VenueRef } from '@/trading/kernel/instrument'
import type { VenueRegistry } from '@/trading/venues/types'

/** A venue and the markets it can hold. `apiHosts` is where its orders go; empty for a venue the
 *  operator trades by hand and one still waiting for its key. */
export interface VenueChoice {
  readonly venue: VenueRef
  readonly markets: readonly MarketRef[]
  readonly apiHosts: readonly string[]
}

/** Every registered venue and the markets it can hold, for a form that asks where a trade sits. */
export function venueChoices(venues: VenueRegistry): readonly VenueChoice[] {
  return venues.list().map((venue) => ({
    venue: venue.manifest.id,
    markets: [...venue.manifest.markets],
    apiHosts: venue.manifest.apiHosts ?? [],
  }))
}

/** Composition rejects a configured default no registered venue holds, so what comes back is
 *  always a venue the ledger validator accepts. */
export function venuesFor(
  venues: VenueRegistry,
  defaults: DefaultVenues,
  market: MarketRef
): readonly VenueRef[] {
  const configured = defaults[market]

  if (configured !== undefined) {
    return [configured]
  }

  return venuesHolding(venues, market)
}

/** Who may hold it at all: a configured default narrows but never overrides, the operator can
 *  still name another registered custodian on a row. */
export function venuesHolding(venues: VenueRegistry, market: MarketRef): readonly VenueRef[] {
  return venues.serving(market).map((venue) => venue.manifest.id)
}
