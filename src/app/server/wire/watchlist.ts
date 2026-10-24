import type { InstrumentRefWire } from '@/app/server/wire/trading'

/** POST /v1/watchlist body: names as you would type them (`fpt`, or `crypto:hdb` where the market
 *  must be named). At least one name in all; `remove` runs first. */
export interface WatchlistUpdateBody {
  readonly add?: readonly string[]
  readonly remove?: readonly string[]
}

/** What changed. The two steps are separate saves, not one transaction: an `add` that names
 *  something nothing matches (or two markets claim) saves none of its names, reports each such name
 *  in `unknown`, and still leaves the `remove` applied. A name already listed, or never listed,
 *  changes nothing and is in neither list. */
export interface WatchlistUpdateResponse {
  readonly added: readonly InstrumentRefWire[]
  readonly removed: readonly InstrumentRefWire[]
  readonly unknown: readonly string[]
}
