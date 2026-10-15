import type { Logger } from '@/core/logging/logger'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { SpotAdapter } from '@/trading/kernel/venue/spot-adapter'
import type { Venue, VenueExecution, VenueRegistry } from '@/trading/venues/types'
import { ConfigError } from '@/core/errors'
import { createRegistrationPhase } from '@/trading/registry-lifecycle'
import { cachingCatalog } from '@/trading/venues/catalog-cache'

const BOUNDARY = 'venue'

const EXECUTION_METHODS: Readonly<Record<keyof VenueExecution, readonly (keyof SpotAdapter)[]>> =
  Object.freeze({
    exit: ['placeExit', 'fetchExit', 'cancelExit', 'listOpenExits'],
    amend: ['amendExit'],
    fills: ['fetchFilledOrders', 'listFilledOrders'],
    balances: ['fetchBalances'],
  })

/** Whether the markets a venue claims are registered is not asked here: this registry holds no
 *  market registry, and giving it one would close a dependency both ways. Composition checks it. */
export function createVenueRegistry(logger: Logger): VenueRegistry {
  const phase = createRegistrationPhase<Venue>(BOUNDARY)

  return {
    // The one place every venue passes through, so no venue has to remember to cache its own.
    register(venue) {
      assertAdapterMatchesManifest(venue)

      phase.add(venue.manifest.id, withCachedCatalog(venue, logger))
    },

    close: phase.close,
    find: (ref) => phase.find(ref),
    list: phase.entries,
    heldMarkets: () => new Set(phase.entries().flatMap((venue) => venue.manifest.markets)),
    serving: (market) => phase.entries().filter((venue) => holds(venue, market)),
    tradable: (market) =>
      phase.entries().filter((venue) => holds(venue, market) && venue.manifest.acceptsOrders),
    listing: (market) =>
      phase.entries().filter((venue) => holds(venue, market) && venue.catalog !== undefined),
  }
}

// The one invariant the type cannot express: `adapter?` is optional to every caller, so nothing but
// this stops a venue claiming it accepts orders with no client to place them. The same for what
// the client can do: a declared capability whose methods are missing, or a method present under a
// capability that was not declared, boots against a manifest no caller can trust.
function assertAdapterMatchesManifest(venue: Venue): void {
  if (venue.manifest.acceptsOrders !== (venue.adapter !== undefined)) {
    throw new ConfigError(
      venue.manifest.acceptsOrders
        ? `venue ${venue.manifest.id} accepts orders but carries no adapter`
        : `venue ${venue.manifest.id} carries an adapter but accepts no orders`,
      undefined,
      [BOUNDARY, venue.manifest.id]
    )
  }

  const declared = declaredCapabilities(venue)

  for (const capability of Object.keys(EXECUTION_METHODS) as (keyof VenueExecution)[]) {
    for (const method of EXECUTION_METHODS[capability]) {
      const present = venue.adapter?.[method] !== undefined

      if (declared[capability] && !present) {
        throw new ConfigError(
          `venue ${venue.manifest.id} declares execution.${capability} but carries no ${method}`,
          undefined,
          [BOUNDARY, venue.manifest.id]
        )
      }

      if (!declared[capability] && present) {
        throw new ConfigError(
          `venue ${venue.manifest.id} carries ${method} but declares no execution.${capability}`,
          undefined,
          [BOUNDARY, venue.manifest.id]
        )
      }
    }
  }
}

function declaredCapabilities(venue: Venue): Record<keyof VenueExecution, boolean> {
  const execution = venue.manifest.execution
  const declared = {
    exit: execution?.exit === 'attached',
    amend: execution?.amend === true,
    fills: execution !== undefined && execution.fills !== 'none',
    balances: execution?.balances === true,
  }

  if (declared.amend && !declared.exit) {
    throw new ConfigError(
      `venue ${venue.manifest.id} declares execution.amend without an attached exit`,
      undefined,
      [BOUNDARY, venue.manifest.id]
    )
  }

  return declared
}

function withCachedCatalog(venue: Venue, logger: Logger): Venue {
  if (venue.catalog === undefined) {
    return venue
  }

  return {
    ...venue,
    catalog: cachingCatalog({ venue: venue.manifest.id, catalog: venue.catalog, logger }),
  }
}

function holds(venue: Venue, market: MarketRef): boolean {
  return venue.manifest.markets.includes(market)
}
