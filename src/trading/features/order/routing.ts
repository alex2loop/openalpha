import type { MarketRef, VenueRef } from '@/trading/kernel/instrument'
import type { OrderSide, SpotAdapter } from '@/trading/kernel/venue/spot-adapter'
import type { Venue, VenueRegistry } from '@/trading/venues/types'
import { OrderError } from '@/trading/features/order/types'
import { INLINE_SEPARATOR } from '@/trading/render/layout'

/** The venue an order was routed to, with the client it will be placed through. `Venue.adapter` is
 *  optional to every other caller; this file is the one place that narrows it, so no order path
 *  repeats a guard the registry already refuses to let fail. */
export interface RoutedVenue {
  readonly id: VenueRef
  readonly adapter: SpotAdapter
}

/** What narrowing produced, carried together so a refusal names the holders without a second fold
 *  of the ledger. `holding` is absent on every path that never asked. */
interface NarrowedVenues {
  readonly candidates: readonly Venue[]
  readonly tradable: readonly Venue[]
  readonly holding?: readonly VenueRef[]
}

interface VenueRouteInput {
  readonly market: MarketRef
  readonly side: OrderSide
  /** Named by the operator. Narrows to itself or to nothing. */
  readonly named?: VenueRef
  readonly venues: VenueRegistry
  /** Which venues currently hold the instrument. Awaited for a sell, because nothing else can fill
   *  one; a buy never pays for the fold of the whole ledger it costs. */
  holdingVenues(): Promise<readonly VenueRef[]>
}

/** Which venue an order goes to. One place rather than inside each command, because the entry and
 *  the exit riding it must agree, and a confirm must land where the prompt said. */
export async function resolveOrderVenue(input: VenueRouteInput): Promise<RoutedVenue> {
  const tradable = input.venues.tradable(input.market)
  const narrowed = await narrowCandidates(input, tradable)
  const [only] = narrowed.candidates

  if (narrowed.candidates.length === 1 && only?.adapter !== undefined) {
    return { id: only.manifest.id, adapter: only.adapter }
  }

  if (narrowed.candidates.length > 1) {
    throw new OrderError('order.venue_ambiguous', buildVenueList(venueIds(narrowed.candidates)))
  }

  throw new OrderError('order.venue_unavailable', buildVenueList(refusalVenues(input, narrowed)))
}

/** What a refusal names when nothing narrowed: the custodians the book says hold the position, or —
 *  when the ask was not a sell — the venues that could have served the market, falling back to
 *  whoever merely holds it. Each answers "nothing here can fill this" with something the operator
 *  can act on, where the empty list just computed would name nobody. */
function refusalVenues(input: VenueRouteInput, narrowed: NarrowedVenues): readonly VenueRef[] {
  if (narrowed.holding !== undefined && narrowed.holding.length > 0) {
    return narrowed.holding
  }

  return narrowed.tradable.length > 0
    ? venueIds(narrowed.tradable)
    : venueIds(input.venues.serving(input.market))
}

function venueIds(venues: readonly Venue[]): readonly VenueRef[] {
  return venues.map((venue) => venue.manifest.id)
}

/** The venue a stored row already names. A confirm and an exit cancel address the venue the
 *  order went to, never one re-derived from the market — which may since have gained a sibling. */
export function adapterFor(venues: VenueRegistry, venue: VenueRef): RoutedVenue {
  const found = venues.find(venue)

  if (found?.adapter === undefined) {
    throw new OrderError('order.venue_unreachable', venue)
  }

  return { id: found.manifest.id, adapter: found.adapter }
}

/** A named venue narrows to itself or to nothing, which is why no separate assertion is needed: one
 *  that is manual, or does not serve this market, simply is not in `tradable`. A sell narrows to
 *  what actually holds the position, since nothing else can fill it — a venue holding none of it
 *  would place an order the exchange refuses, which is a refusal better read here. */
async function narrowCandidates(
  input: VenueRouteInput,
  tradable: readonly Venue[]
): Promise<NarrowedVenues> {
  const named =
    input.named === undefined
      ? tradable
      : tradable.filter((venue) => venue.manifest.id === input.named)

  if (input.side !== 'sell' || named.length === 0) {
    return { candidates: named, tradable }
  }

  const holding = await input.holdingVenues()

  return {
    candidates: named.filter((venue) => holding.includes(venue.manifest.id)),
    tradable,
    holding,
  }
}

/** Exported so a refusal reads the same wherever it is raised — the exit path refuses over a
 *  venue list too. */
export function buildVenueList(venues: readonly VenueRef[]): string {
  return venues.join(INLINE_SEPARATOR)
}
