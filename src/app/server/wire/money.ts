// The /v1 money contract: the ledger, the rebalance plan, stop levels and venue reconciliation.
// Same rules as `wire/trading.ts`. Every `*PctNav` and `*Pct` here is a percent (58.3 means
// 58.3%), unlike the older `sizePctNav` and `*ReturnPct` fields, which are fractions.

import type {
  InstrumentRefWire,
  SuggestionWire,
  TradingWireCaveat,
} from '@/app/server/wire/trading'

export interface FxConversionWire {
  readonly fromCurrency: string
  readonly toCurrency: string
  readonly rate: number
  readonly source: 'identity' | 'provider' | 'operator'
}

export interface LedgerEntryBaseWire {
  readonly id: string
  readonly recordedAt: number
  readonly updatedAt?: number
  readonly at: string
  readonly settledAt: string
  readonly note?: string
  readonly venue: string
}

/** One arm per transaction family, so a cash row never carries an empty quantity. */
export type LedgerEntryWire =
  | (LedgerEntryBaseWire & {
      readonly kind: 'deposit' | 'withdrawal' | 'fee' | 'loss'
      readonly currency: string
      readonly amount: number
      readonly conversion: FxConversionWire
    })
  | (LedgerEntryBaseWire & {
      readonly kind: 'transfer'
      readonly fromVenue: string
      readonly currency: string
      readonly amount: number
      readonly fee: number
      readonly conversion: FxConversionWire
    })
  | (LedgerEntryBaseWire & {
      readonly kind: 'buy' | 'sell' | 'rights'
      readonly instrument: InstrumentRefWire
      readonly currency: string
      readonly quantity: number
      readonly unitPrice: number
      readonly fee: number
      readonly closeReason?: 'stop' | 'target'
      readonly conversion: FxConversionWire
    })
  | (LedgerEntryBaseWire & {
      readonly kind: 'dividend'
      readonly instrument: InstrumentRefWire
      readonly currency: string
      readonly amount: number
      readonly conversion: FxConversionWire
    })
  | (LedgerEntryBaseWire & {
      readonly kind: 'split' | 'distribution'
      readonly instrument: InstrumentRefWire
      readonly quantityDelta: number
    })

/** GET /v1/ledger?limit&cursor&fromDay&toDay — newest first. */
export interface LedgerPageResponse {
  readonly entries: readonly LedgerEntryWire[]
  readonly nextCursor?: string
}

/** POST /v1/ledger, PATCH and DELETE /v1/ledger/:id. The book is not echoed: read
 *  `/v1/portfolio` again after a write. */
export interface LedgerWriteResponse {
  readonly kind: 'recorded' | 'updated' | 'deleted'
  readonly entry: LedgerEntryWire
  /** Where a recorded trade's figures came from: `operator` is what was typed, the `venue*` arms
   *  are the exchange's own fill. Absent on an edit or a delete. */
  readonly fillSource?: 'venue' | 'venueSized' | 'venuePriced' | 'operator'
  /** A row already holding the same content. Recorded anyway: the same trade twice in a day is real. */
  readonly duplicateOf?: string
  /** The exit plan a recorded buy earned, written in the same call. */
  readonly planned?: SuggestionWire
}

/** GET /v1/stops — the stop each holding's latest plan names, and who stands behind it at the
 *  exchange. `distanceToStopPct` at or below 0 means the mark is through the stop. A held name with
 *  no row is below the venue's minimum size. */
export interface StopsResponse {
  readonly stops: readonly {
    readonly instrument: InstrumentRefWire
    readonly plan: 'none' | 'distance'
    readonly stop?: number
    readonly takeProfit?: number
    readonly distanceToStopPct?: number
    /** The mark the distance was measured from; absent when the holding has no price. */
    readonly price?: number
    /** A fund's lower level is a review, not a sale. */
    readonly review: boolean
    /** An exit this daemon placed, one set in the exchange's own app, or none. Absent where no order
     *  could rest: no exchange account, a custodian with no client, or a venue that did not answer. */
    readonly cover?: 'placed' | 'venue' | 'none'
  }[]
}

interface RebalanceSegmentWire {
  readonly segment: string
  readonly currentPctNav: number
  readonly targetPctNav: number
  readonly afterPlanPctNav: number
  readonly driftBandPctNav: number
  readonly capPctNav?: number
}

interface RebalanceChangeWire {
  readonly instrument: InstrumentRefWire
  readonly segment: string
  readonly sector?: string
  readonly instrumentKind?: string
  readonly currentPctNav: number
  readonly targetPctNav: number
  readonly changePctNav: number
  readonly reason: 'fill-gap' | 'core-fill' | 'trim' | 'weak-signal' | 'off-policy' | 'over-cap'
  /** The order this change works out to, lot-rounded. Absent when the plan could not be sized. */
  readonly order?: {
    readonly valueBase: number
    readonly quantity: number
    readonly boardLot: number
    readonly unitPrice: number
    readonly currency: string
  }
  readonly caveats: readonly TradingWireCaveat[]
}

/** A read of the book: `code` names the kind, `data` the values its message interpolates, with
 *  shares as fractions (0.174 = 17.4%), as the runtime's own message renders them. */
interface PortfolioFindingWire {
  readonly code: string
  readonly direction: 'positive' | 'negative'
  readonly data: Readonly<Record<string, string | number>>
}

/** The CLI's lines for a rebalance plan; the numbers beside them are for prefilling a ledger row. */
export interface RebalanceTextWire {
  /** The answer first: the plan in one line, what leaving it undone costs, what it leaves behind.
   *  When the plan is unavailable, the reason sentence and nothing else. */
  readonly headline: readonly string[]
  /** The words the two order groups sit under. */
  readonly groups: { readonly first: string; readonly later: string }
  /** One row per change, breaches (`first`) before the rest (`later`); a line may span several
   *  lines separated by a newline. */
  readonly orders: readonly {
    readonly instrument: InstrumentRefWire
    readonly group: 'first' | 'later'
    readonly line: string
  }[]
  readonly segments: readonly string[]
  readonly notes: readonly string[]
}

/** GET /v1/rebalance — the plan for today, sized in money where the book could be priced. */
export type RebalanceResponse =
  | {
      readonly status: 'ready'
      readonly baseCurrency?: string
      readonly navBase?: number
      /** 0 to 1: how much of a full buy today's market read allows. */
      readonly deploymentScale: number
      readonly segments: readonly RebalanceSegmentWire[]
      readonly changes: readonly RebalanceChangeWire[]
      readonly cash: {
        readonly cashPctNav: number
        readonly liquidReservePctNav: number
        readonly termDepositEligiblePctNav: number
        readonly posture: string
      }
      readonly findings: readonly PortfolioFindingWire[]
      readonly caveats: readonly TradingWireCaveat[]
      readonly text: RebalanceTextWire
    }
  | {
      readonly status: 'unavailable'
      readonly reason:
        | 'zero-nav'
        | 'incomplete-valuation'
        | 'insufficient-policy-input'
        | 'unresolved-names'
      readonly findings: readonly PortfolioFindingWire[]
      readonly caveats: readonly TradingWireCaveat[]
      readonly text: RebalanceTextWire
    }

/** GET /v1/reconcile — the book against each venue's own balances. A venue that matches has no
 *  mismatches; `uncompared` says why one was left out (`unreachable` may work on retry, `keyless`
 *  waits for the keys `missingCredentials` names, `unsupported` has no balance feed). */
export interface ReconcileResponse {
  /** The runtime's sentences, each present only where it is true: `matched` only when a venue
   *  answered and every answer agrees, `cashNote` only when something disagrees. */
  readonly text: {
    readonly matched: string | null
    readonly cashNote: string | null
  }
  readonly venues: readonly {
    readonly venue: string
    readonly mismatches: readonly {
      readonly asset: string
      readonly booked: number
      readonly held: number
      /** Book minus venue. */
      readonly delta: number
    }[]
    readonly uncompared?: 'unreachable' | 'keyless' | 'unsupported'
    readonly missingCredentials?: readonly string[]
  }[]
}

/** GET /v1/venues - every venue a trade can be recorded at and the markets it holds. */
export interface VenuesResponse {
  readonly venues: readonly { readonly venue: string; readonly markets: readonly string[] }[]
}
