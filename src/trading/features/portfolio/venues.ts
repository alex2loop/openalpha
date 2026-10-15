import type { VenueChoice } from '@/trading/features/portfolio/types'
import type { DefaultVenues } from '@/trading/kernel/config'
import type { MarketRef, VenueRef } from '@/trading/kernel/instrument'
import type { VenueRegistry } from '@/trading/venues/types'

/** Every registered venue and the markets it can hold, for a form that asks where a trade sits. */
export function venueChoices(venues: VenueRegistry): readonly VenueChoice[] {
  return venues.list().map((venue) => ({
    venue: venue.manifest.id,
    markets: [...venue.manifest.markets],
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
