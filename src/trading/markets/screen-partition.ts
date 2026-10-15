import type { InstrumentRef, Ticker } from '@/trading/kernel/instrument'
import type { ScreenRejection } from '@/trading/kernel/market/market-capability'
import type { ScreenGateCode } from '@/trading/kernel/screen-codes'
import type { VenueListing } from '@/trading/kernel/venue/catalog'

/** Wider than fragmented liquidity ever gets on a name worth ranking, and narrower than the gap a
 *  ticker carrying a different token on each book opens: measured on one board, the majors agreed
 *  across exchanges to under a tenth of a percent while a redenominated coin stood at twice its
 *  venue's price. */
const MAXIMUM_VENUE_PRICE_DIVERGENCE_FRACTION = 0.1

interface ScreenPartition<T> {
  readonly survivors: readonly T[]
  readonly rejections: readonly ScreenRejection[]
}

export type ScreenGateVerdict =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'rejected'; readonly code: ScreenGateCode }

/** Splitting rather than filtering is the whole point: a gate code is why a name is absent, and a
 *  screen that only returns survivors cannot answer why a name it rejected is missing. */
export type GateCounts = Readonly<Partial<Record<ScreenGateCode, number>>>

export function countByGate(rejections: readonly ScreenRejection[]): GateCounts {
  const counts: Partial<Record<ScreenGateCode, number>> = {}

  for (const rejection of rejections) {
    counts[rejection.code] = (counts[rejection.code] ?? 0) + 1
  }

  return counts
}

export function partitionByGate<T>(
  candidates: readonly T[],
  instrumentOf: (candidate: T) => InstrumentRef,
  gate: (candidate: T) => ScreenGateVerdict
): ScreenPartition<T> {
  const survivors: T[] = []
  const rejections: ScreenRejection[] = []

  for (const candidate of candidates) {
    const verdict = gate(candidate)

    if (verdict.kind === 'accepted') {
      survivors.push(candidate)
      continue
    }

    rejections.push({ instrument: instrumentOf(candidate), code: verdict.code })
  }

  return { survivors, rejections }
}

/** Any row that carries an instrument, so the caller passes rows and not a projection of them.
 *  `priceOf` is what the board will present and size from, which is the price the venue has to
 *  agree with for the levels built on it to be reachable. */
export function partitionByVenueListing<T extends { readonly instrument: InstrumentRef }>(
  rows: readonly T[],
  listing: VenueListing,
  priceOf: (row: T) => number
): ScreenPartition<T> {
  return partitionByGate(
    rows,
    (row) => row.instrument,
    (row) => venueListingVerdict(row.instrument.ticker, priceOf(row), listing)
  )
}

/** A market whose venues publish no catalog is not gated: nothing was promised, so nothing is
 *  missing. The same holds when every catalog failed — the caveat says so, and a board of names
 *  the operator may not be able to buy beats no board at all. A listed name the venue quotes no
 *  price for is gated on listing alone, for the same reason. */
function venueListingVerdict(
  ticker: Ticker,
  price: number,
  listing: VenueListing
): ScreenGateVerdict {
  if (listing.kind !== 'listed') {
    return { kind: 'accepted' }
  }

  if (!listing.tickers.has(ticker)) {
    return { kind: 'rejected', code: 'not-listed-on-venue' }
  }

  return hasDivergedFromVenue(price, listing.prices.get(ticker))
    ? { kind: 'rejected', code: 'venue-price-diverged' }
    : { kind: 'accepted' }
}

/** Measured against the venue's own price, because that is the one an order fills at and the one
 *  every level the board publishes would have to be reachable from. */
function hasDivergedFromVenue(price: number, venuePrice: number | undefined): boolean {
  if (venuePrice === undefined || venuePrice <= 0 || !Number.isFinite(price)) {
    return false
  }

  return Math.abs(price - venuePrice) / venuePrice > MAXIMUM_VENUE_PRICE_DIVERGENCE_FRACTION
}
