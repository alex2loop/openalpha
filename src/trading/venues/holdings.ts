import type { InstrumentRef, MarketRef } from '@/trading/kernel/instrument'
import type { Book, Position } from '@/trading/kernel/operator/book'
import type { VenueInstrument } from '@/trading/kernel/venue/catalog'
import type { SpotAdapter } from '@/trading/kernel/venue/spot-adapter'
import type { Venue, VenueRegistry } from '@/trading/venues/types'
import { isAbortError } from '@/core/errors'
import { buildInstrumentKey } from '@/trading/kernel/instrument'

/** Available cash a buy in each market could actually reach: the venues that can place orders in it.
 *  A market no tradable venue serves is absent rather than zero — the sizer must not read "no cash"
 *  as a reason to hold a name the operator trades by hand. */
export function reachableCashByMarket(
  venues: VenueRegistry,
  book: Book
): ReadonlyMap<MarketRef, number> {
  const reachable = new Map<MarketRef, number>()

  for (const venue of venues.list()) {
    if (!venue.manifest.acceptsOrders) {
      continue
    }

    const available = book.cashByVenue.get(venue.manifest.id)?.available ?? 0

    for (const market of venue.manifest.markets) {
      reachable.set(market, (reachable.get(market) ?? 0) + available)
    }
  }

  return reachable
}

/** The smallest order one venue accepts in each asset it lists, so a reader can tell a holding it
 *  could act on from residue no trade would clear. Empty when the venue publishes no catalog or the
 *  catalog cannot be reached: a floor nobody answered for hides nothing. */
export async function venueMinimumSizes(
  venue: Venue,
  signal: AbortSignal
): Promise<ReadonlyMap<string, number>> {
  return smallestSizes((await catalogRows(venue, signal)) ?? [], (row) => row.ticker)
}

/** The tightest floor each held instrument faces, across the venues actually holding it. One read
 *  per venue rather than per position, and the smallest wins: a name at two custodians is residue
 *  only where neither would trade it. */
export async function minimumSizesByInstrument(
  venues: VenueRegistry,
  positions: readonly Position[],
  signal: AbortSignal
): Promise<ReadonlyMap<string, number>> {
  const sized = await Promise.all(
    venuesHolding(venues, positions).map(async (venue) => ({
      venue: venue.manifest.id,
      sizes: smallestSizes((await catalogRows(venue, signal)) ?? [], buildInstrumentKey),
    }))
  )
  const byVenue = new Map(sized.map((entry) => [entry.venue, entry.sizes]))
  const floors = new Map<string, number>()

  for (const position of positions) {
    const key = buildInstrumentKey(position.instrument)
    const size = byVenue.get(position.venue)?.get(key)
    const known = floors.get(key)

    if (size !== undefined && (known === undefined || size < known)) {
      floors.set(key, size)
    }
  }

  return floors
}

/** The venue's own symbol to the instrument it names, built by mapping each catalog row *forward*
 *  through the adapter rather than by parsing the symbol backward, so the index is exact by
 *  construction: it is the same function the order path builds symbols with.
 *
 *  Empty where the venue publishes no catalog or it could not be read: a symbol this cannot answer
 *  falls through to the caller's own resolution, which is what happens for a pair the venue has
 *  since delisted. */
export async function instrumentsBySymbol(
  venue: Venue,
  adapter: SpotAdapter,
  signal: AbortSignal
): Promise<ReadonlyMap<string, InstrumentRef>> {
  const rows = (await catalogRows(venue, signal)) ?? []

  return new Map(
    rows.map((row) => {
      const instrument: InstrumentRef = { market: row.market, ticker: row.ticker }

      return [adapter.toSymbol(instrument), instrument]
    })
  )
}

/** `undefined` for a catalog that is absent or could not be read, never an empty list: an empty
 *  list is an answer, and a caller inheriting one from a failure picks a direction nobody chose.
 *  Which direction is right differs per caller, so each states its own at the `??` below. */
async function catalogRows(
  venue: Venue,
  signal: AbortSignal
): Promise<readonly VenueInstrument[] | undefined> {
  if (venue.catalog === undefined) {
    return undefined
  }

  try {
    return await venue.catalog.listInstruments(signal)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return undefined
  }
}

/** The venues a set of positions actually sits at, so one catalog read serves every position held
 *  there rather than one read per position. */
function venuesHolding(venues: VenueRegistry, positions: readonly Position[]): readonly Venue[] {
  const held = new Set(positions.map((position) => position.venue))

  return venues.list().filter((venue) => held.has(venue.manifest.id))
}

/** The smallest order the venue accepts for each asset, keyed by the caller's own reading of a row.
 *  The reconcile read keys on the ticker, because an exchange reports one balance per asset whatever
 *  markets list the name; every other reader keys on the instrument, so a name two markets share is
 *  read against its own market's row rather than a sibling's. */
function smallestSizes(
  rows: readonly VenueInstrument[],
  keyOf: (row: VenueInstrument) => string
): ReadonlyMap<string, number> {
  const floors = new Map<string, number>()

  for (const row of rows) {
    const key = keyOf(row)
    const known = floors.get(key)

    if (known === undefined || row.minimumSize < known) {
      floors.set(key, row.minimumSize)
    }
  }

  return floors
}
