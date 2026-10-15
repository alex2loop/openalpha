import type { MarketRef, VenueRef } from '@/trading/kernel/instrument'
import type { Venue } from '@/trading/venues/types'

interface ManualVenueInput {
  readonly id: VenueRef
  readonly markets: readonly MarketRef[]
}

/** A venue this tree records and never places on. It carries no adapter, so routing can never
 *  select it and no order path can reach an exchange it has no client for. */
export function createManualVenue(input: ManualVenueInput): Venue {
  return {
    manifest: {
      id: input.id,
      markets: input.markets,
      acceptsOrders: false,
    },
  }
}
