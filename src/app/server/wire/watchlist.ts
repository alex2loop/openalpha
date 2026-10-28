import type { InstrumentRefWire } from '@/app/server/wire/trading'

/** POST /v1/watchlist body: names as you would type them (`fpt`, or `crypto:hdb` where the market
 *  must be named). At least one name in all; `remove` runs first. */
export interface WatchlistUpdateBody {
  readonly add?: readonly string[]
  readonly remove?: readonly string[]
}

/** What changed. The two steps are separate saves, not one transaction: an `add` that names
 *  something nothing matches (`unknown`) or two markets claim (`ambiguous`, to be written
 *  `market:ticker`) saves none of its names and still leaves the `remove` applied. When the refusal
 *  names no name (the market list is not loaded yet), every requested name is in `unknown` and
 *  `message` says why, in the daemon's language. A name already listed, or never listed, changes
 *  nothing and is in no list. */
export interface WatchlistUpdateResponse {
  readonly added: readonly InstrumentRefWire[]
  readonly removed: readonly InstrumentRefWire[]
  readonly unknown: readonly string[]
  readonly ambiguous: readonly string[]
  readonly message?: string
}
