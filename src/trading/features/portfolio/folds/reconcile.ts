import type { VenueRef } from '@/trading/kernel/instrument'
import type { Position } from '@/trading/kernel/operator/book'
import type { VenueBalance } from '@/trading/kernel/venue/spot-adapter'
import { QUANTITY_EPSILON } from '@/trading/features/ledger/position'
import { isBelowMinimumSize } from '@/trading/kernel/venue/catalog'

/** One asset the book and the custodian disagree about. Absent from either side is zero, never
 *  unknown: a venue omits what it holds none of, and the book omits what it never bought. */
interface ReconciledAsset {
  readonly asset: string
  readonly booked: number
  readonly held: number
  /** Book minus venue. Positive is a holding the exchange cannot find. */
  readonly delta: number
  /** The venue's cash currency, which a deposit or withdrawal corrects rather than a trade. */
  readonly cash: boolean
}

export interface VenueReconciliation {
  readonly venue: VenueRef
  /** Only the assets that disagree, so a venue that matches renders as one line rather than an
   *  inventory. Empty where `uncompared` says why the venue was left out. */
  readonly mismatches: readonly ReconciledAsset[]
  /** Why this venue is outside the reading, and absent on one that answered. A venue left out of
   *  the reading entirely reads as a venue that agreed, which is what this names instead:
   *  `unreachable` was asked and did not answer, so asking again may work; `keyless` waits for the
   *  key `missingCredentials` names; `unsupported` has no balances client at all, so no retry ever
   *  will. */
  readonly uncompared?: 'unreachable' | 'keyless' | 'unsupported'
  readonly missingCredentials?: readonly string[]
  /** Whether the venue lists its fills, so `/record sync` can book what the ledger lacks. */
  readonly canSync: boolean
}

interface ReconcileInput {
  readonly venue: VenueRef
  readonly positions: readonly Position[]
  readonly balances: readonly VenueBalance[]
  /** What cash sits in at this venue: its quote asset. It is compared only where the book holds
   *  that currency's cash here (`bookedCash`); otherwise the book keeps this venue's cash in its base
   *  currency and nothing converts one to the other. */
  readonly cashAsset: string
  /** The book's currency cash in `cashAsset` at this venue; absent when the book holds none, which
   *  leaves the asset uncompared. */
  readonly bookedCash?: number | undefined
  /** The venue's own floor under each asset it trades. Empty where no catalog answered, which
   *  reports every residue rather than hiding a break behind a lookup that failed. */
  readonly minimumSizes: ReadonlyMap<string, number>
  readonly canSync: boolean
}

export function reconcileVenue(input: ReconcileInput): VenueReconciliation {
  const booked = bookedByAsset(input.positions, input.venue)
  const held = heldByAsset(input.balances)
  const mismatches: ReconciledAsset[] = []

  const assets = new Set([...booked.keys(), ...held.keys()])

  // The exchange omits a zero balance, so a book holding cash against an exchange holding none
  // would never be visited.
  if (input.bookedCash !== undefined) {
    assets.add(input.cashAsset)
  }

  for (const asset of [...assets].sort()) {
    if (asset === input.cashAsset && input.bookedCash === undefined) {
      continue
    }

    const bookedQuantity =
      asset === input.cashAsset ? (input.bookedCash ?? 0) : (booked.get(asset) ?? 0)
    const heldQuantity = held.get(asset) ?? 0
    const delta = bookedQuantity - heldQuantity

    if (Math.abs(delta) <= QUANTITY_EPSILON) {
      continue
    }

    if (isUnclaimedDust(input.minimumSizes.get(asset), bookedQuantity, heldQuantity)) {
      continue
    }

    mismatches.push({
      asset,
      booked: bookedQuantity,
      held: heldQuantity,
      delta,
      cash: asset === input.cashAsset,
    })
  }

  return { venue: input.venue, mismatches, canSync: input.canSync }
}

/** Dust the operator cannot act on: the book claims none of it, and what the venue holds is below
 *  the smallest order that venue accepts, so there is no trade that would clear it and nothing to
 *  record. A venue that publishes no floor reports everything. */
function isUnclaimedDust(minimumSize: number | undefined, booked: number, held: number): boolean {
  return booked <= QUANTITY_EPSILON && isBelowMinimumSize(held, minimumSize)
}

/** Summed rather than assigned: nothing stops two markets listing one ticker at the same venue, and
 *  the exchange reports a single balance for both. */
function bookedByAsset(
  positions: readonly Position[],
  venue: VenueRef
): ReadonlyMap<string, number> {
  const booked = new Map<string, number>()

  for (const position of positions) {
    if (position.venue === venue) {
      const asset = position.instrument.ticker

      booked.set(asset, (booked.get(asset) ?? 0) + position.quantity)
    }
  }

  return booked
}

function heldByAsset(balances: readonly VenueBalance[]): ReadonlyMap<string, number> {
  return new Map(balances.map((balance) => [balance.asset, balance.quantity]))
}
