import type { MarketRef, VenueRef } from '@/trading/kernel/instrument'
import type { VenueCatalog } from '@/trading/kernel/venue/catalog'
import type { SpotAdapter } from '@/trading/kernel/venue/spot-adapter'

export interface VenueManifest {
  readonly id: VenueRef
  /** Which markets this venue can hold and trade. */
  readonly markets: readonly MarketRef[]
  /** False where the operator places orders by hand and this tree only records them - build one
   *  with `createManualVenue`. Such a venue carries no adapter and is never a routing candidate. */
  readonly acceptsOrders: boolean
  /** Absent on a venue that accepts no orders. */
  readonly execution?: VenueExecution
  /** Set only on an exchange waiting for its key: what tells it apart from a venue traded by hand. */
  readonly missingCredentials?: readonly string[]
}

/** What this venue's API can be asked to do, as opposed to what the protocol vocabulary can
 *  express. A broker that rests no bracket order declares `exit: 'none'` rather than carrying four
 *  methods that throw. */
export interface VenueExecution {
  readonly exit: 'attached' | 'none'
  /** Whether a resting exit can be moved in place. A venue that cannot is refused the move, never
   *  given a cancel-then-place: that is the one shape whose second failure leaves no protection. */
  readonly amend: boolean
  /** `by-symbol` lists fills only for the symbols it is asked about, which the sync says aloud. */
  readonly fills: 'enumerable' | 'by-symbol' | 'none'
  readonly balances: boolean
}

export interface Venue {
  readonly manifest: VenueManifest
  /** Present exactly when `manifest.acceptsOrders`. */
  readonly adapter?: SpotAdapter
  /** Independent of `adapter`: an exchange publishes what it lists without credentials, so a
   *  venue that accepts no orders can still answer what it carries. */
  readonly catalog?: VenueCatalog
}

export interface VenueRegistry {
  register(venue: Venue): void
  close(): void
  find(ref: VenueRef): Venue | null
  list(): readonly Venue[]
  /** Every market some venue holds; any other is read for reference only. */
  heldMarkets(): ReadonlySet<MarketRef>
  /** Every venue that can hold this market, in registration order. */
  serving(market: MarketRef): readonly Venue[]
  /** Those of them an order can actually be placed on. A venue the operator trades by hand holds
   *  the market and can never fill anything, so routing and the cost line both ask this. */
  tradable(market: MarketRef): readonly Venue[]
  /** Those of them that publish a catalog. Separate from `tradable`, because what a venue lists
   *  and what this tree may place on it are answered by different halves of its API. */
  listing(market: MarketRef): readonly Venue[]
}

/** What an exchange says one API key may do. */
export interface VenueKeyRestrictions {
  readonly withdrawals: boolean
  readonly ipRestricted: boolean
  readonly trading: boolean
}
