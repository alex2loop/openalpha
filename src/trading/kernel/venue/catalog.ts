import type { MarketRef, Ticker } from '@/trading/kernel/instrument'

/** One asset a venue lists, with the floor under what it will trade in it. */
export interface VenueInstrument {
  readonly ticker: Ticker
  /** Which of the venue's markets this row belongs to. A venue serving several markets returns one
   *  flat list, and a consumer asking what a market lists must not be handed a sibling's names. */
  readonly market: MarketRef
  /** Smallest quantity the venue accepts an order for, so a holding under it cannot be acted on. */
  readonly minimumSize: number
}

/** Whether a quantity is too small for the venue to trade, which is what separates a holding the
 *  operator can act on from residue a full exit left behind. A venue that publishes no floor hides
 *  nothing: an unknown minimum is not a small one. */
export function isBelowMinimumSize(quantity: number, minimumSize: number | undefined): boolean {
  return minimumSize !== undefined && quantity < minimumSize
}

/** What a venue lists, which is public, as opposed to what may be placed on it, which is
 *  credentialed. A venue the operator trades by hand publishes none. Listing and pricing are two
 *  reads because they are asked at different rates: the exit reconcile wants floors every tick and
 *  never a price, and a price cached at the listing's pace would be stale past any use. */
export interface VenueCatalog {
  listInstruments(signal: AbortSignal): Promise<readonly VenueInstrument[]>
  /** Last traded price per base asset, in the currency the venue settles pairs in. Absent for an
   *  instrument the venue lists but nobody has traded. */
  listPrices(signal: AbortSignal): Promise<ReadonlyMap<Ticker, number>>
}

/** `none` means no venue holding the market publishes a catalog, so nothing was promised and
 *  nothing is missing. `unavailable` means every catalog that exists failed to answer, which is a
 *  degradation the operator must be told about. */
export type VenueListing =
  | {
      readonly kind: 'listed'
      readonly tickers: ReadonlySet<Ticker>
      /** What the venue itself quotes, against which a board's own price is checked. A listed
       *  ticker missing here is priced by nobody rather than unlisted. */
      readonly prices: ReadonlyMap<Ticker, number>
    }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'none' }

/** A market's view of what its venues carry. Consumer-side: the market asks what it may rank and
 *  never learns that venues, adapters or a registry exist. */
export interface VenueListings {
  readListing(market: MarketRef, signal: AbortSignal): Promise<VenueListing>
}
