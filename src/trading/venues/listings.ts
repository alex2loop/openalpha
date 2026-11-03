import type { Logger } from '@/core/logging/logger'
import type { DefaultVenues } from '@/trading/kernel/config'
import type { MarketRef, Ticker, VenueRef } from '@/trading/kernel/instrument'
import type {
  VenueCatalog,
  VenueInstrument,
  VenueListing,
  VenueListings,
} from '@/trading/kernel/venue/catalog'
import type { Venue, VenueRegistry } from '@/trading/venues/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

interface VenueAnswer {
  readonly tickers: readonly Ticker[]
  /** Empty where the venue lists but could not be asked what it quotes: a price nobody answered for
   *  leaves the divergence gate silent rather than rejecting the whole board. */
  readonly prices: ReadonlyMap<Ticker, number>
}

/** The venues the operator's book names, read from the ledger. */
interface VenueBook {
  listVenues(signal: AbortSignal): Promise<ReadonlySet<VenueRef>>
}

interface VenueListingsDeps {
  readonly venues: VenueRegistry
  readonly defaultVenues: DefaultVenues
  readonly book: VenueBook
  readonly logger: Logger
}

/** The union of the catalogs of the venues the operator trades the market at. One venue failing
 *  costs its own names and not the gate: a name the survivors list is listed, whatever the venue
 *  that could not answer carries. Only a market where nothing answered degrades to `unavailable`. */
export function createVenueListings(deps: VenueListingsDeps): VenueListings {
  const { logger } = deps

  return {
    async readListing(market: MarketRef, signal: AbortSignal): Promise<VenueListing> {
      const catalogs = await catalogsInUse(deps, market, signal)

      if (catalogs.length === 0) {
        return { kind: 'none' }
      }

      const answers = await Promise.all(
        catalogs.map((venue) => listOne({ venue, market, signal, logger }))
      )
      const answered = answers.filter((answer) => answer !== undefined)

      if (answered.length === 0) {
        return { kind: 'unavailable' }
      }

      return {
        kind: 'listed',
        tickers: new Set(answered.flatMap((answer) => answer.tickers)),
        prices: mergePrices(answered),
      }
    },
  }
}

/** Registration order is precedence: a name two venues both quote is priced by the first of them
 *  that holds it. */
function mergePrices(answers: readonly VenueAnswer[]): ReadonlyMap<Ticker, number> {
  const prices = new Map<Ticker, number>()

  for (const answer of answers) {
    for (const [name, price] of answer.prices) {
      if (!prices.has(name)) {
        prices.set(name, price)
      }
    }
  }

  return prices
}

/** A venue is in use when it is the market's default, holds the operator's key, or carries a row of
 *  the book. Where none of those publishes a catalog, or the book cannot be read, every catalog
 *  serving the market counts, so the board stays open rather than empty. */
async function catalogsInUse(
  deps: VenueListingsDeps,
  market: MarketRef,
  signal: AbortSignal
): Promise<readonly Venue[]> {
  const catalogs = deps.venues.listing(market)
  const inUse = await venuesInUse(deps, market, signal)
  const used = catalogs.filter((venue) => inUse?.has(venue.manifest.id) === true)

  return used.length === 0 ? catalogs : used
}

async function venuesInUse(
  deps: VenueListingsDeps,
  market: MarketRef,
  signal: AbortSignal
): Promise<ReadonlySet<VenueRef> | undefined> {
  const defaultVenue = deps.defaultVenues[market]
  const keyed = deps.venues.tradable(market).map((venue) => venue.manifest.id)

  try {
    const booked = await deps.book.listVenues(signal)

    return new Set([...keyed, ...booked, ...(defaultVenue === undefined ? [] : [defaultVenue])])
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.venue_book_unreadable', { market, err: formatErrForLog(err) })

    return undefined
  }
}

interface ListOneInput {
  readonly venue: Venue
  readonly market: MarketRef
  readonly signal: AbortSignal
  readonly logger: Logger
}

async function listOne(input: ListOneInput): Promise<VenueAnswer | undefined> {
  const { venue, market, signal, logger } = input
  const catalog = venue.catalog

  if (catalog === undefined) {
    return undefined
  }

  let rows: readonly VenueInstrument[]

  try {
    const listed = await catalog.listInstruments(signal)

    // A well-formed empty answer is indistinguishable from an exchange that lists nothing, and the
    // transport's retries do not see it as an error. Read as listed, it would reject every name on
    // the board with no caveat; read as this venue failing, the fold degrades and says so.
    if (listed.length === 0) {
      logger.warn('trading.venue_catalog_empty', { venue: venue.manifest.id })

      return undefined
    }

    rows = listed.filter((instrument) => instrument.market === market)
  } catch (err: unknown) {
    logger.warn('trading.venue_catalog_unavailable', {
      venue: venue.manifest.id,
      err: formatErrForLog(err),
    })

    return undefined
  }

  const tickers = rows.map((instrument) => instrument.ticker)

  // A venue that listed rows but none for this market answered the question and holds nothing here,
  // which is not the same fact as the catalog above being empty. No price read: there is nothing to
  // price, and the call would spend a rate limit to return the same empty map.
  if (tickers.length === 0) {
    return { tickers, prices: new Map() }
  }

  return { tickers, prices: await priceOne({ venue, catalog, signal, logger }) }
}

/** Best-effort beside the listing it rides with: what a venue lists decides whether a name may be
 *  ranked at all, while what it quotes only sharpens that answer, so a price read that failed must
 *  not cost the board its gate. */
async function priceOne(input: {
  readonly venue: Venue
  readonly catalog: VenueCatalog
  readonly signal: AbortSignal
  readonly logger: Logger
}): Promise<ReadonlyMap<Ticker, number>> {
  try {
    return await input.catalog.listPrices(input.signal)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    input.logger.warn('trading.venue_prices_unavailable', {
      venue: input.venue.manifest.id,
      err: formatErrForLog(err),
    })

    return new Map()
  }
}
