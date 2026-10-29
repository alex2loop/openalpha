// The /v1/trade contract: orders on the venues that place them (crypto exchanges with keys). An
// order is staged in chat or by the agent and confirmed here; nothing on this surface stages one.
// Prices are in the instrument's market currency; instants are epoch milliseconds.

import type { InstrumentRefWire } from '@/app/server/wire/trading'

type OrderSideWire = 'buy' | 'sell'

/** An order staged and waiting for the operator, in the terms they staged it in. */
export interface StagedOrderWire {
  /** The confirmation token: confirm or discard names it. Usable once. */
  readonly token: string
  readonly instrument: InstrumentRefWire
  readonly venue: string
  readonly side: OrderSideWire
  readonly orderType: 'market' | 'limit'
  readonly quantity: number
  readonly limitPrice?: number
  readonly takeProfit?: number
  readonly stopLoss?: number
  /** The quote the order was sized against when it was staged. */
  readonly quotePrice: number
  /** What it costs in the book's own currency. */
  readonly notionalBase: number
  readonly createdAt: number
}

/** A take-profit / stop-loss order resting at the exchange under a held position. */
export interface RestingExitWire {
  readonly instrument: InstrumentRefWire
  readonly venue: string
  readonly quantity: number
  readonly takeProfit?: number
  readonly stopLoss?: number
  /** What the levels are quoted in; absent when the market is no longer registered. */
  readonly currency?: string
  readonly placedAt: number
}

/** A position with less exit resting under it than the book holds. */
export interface UnguardedPositionWire {
  readonly instrument: InstrumentRefWire
  readonly venue: string
  readonly quantity: number
  /** How much of it an exit covers. */
  readonly guarded: number
}

/** What the exchange took that the ledger never got; it counts against the caps until settled. */
export interface UnmirroredOrderWire {
  readonly token: string
  readonly instrument: InstrumentRefWire
  readonly venue: string
  readonly side: OrderSideWire
  readonly quantity: number
  readonly createdAt: number
  /** Why the book did not get it, as the runtime recorded it. */
  readonly failure: string
  /** Absent when the exchange never named an order: whether anything filled is unknown. */
  readonly orderId?: string
  /** What the exchange filled, where it reported a fill; `quantity` is what was staged. */
  readonly filledQuantity?: number
  /** The fill's average price, in the venue's quote. */
  readonly averagePrice?: number
}

/** GET /v1/trade */
export interface TradeStatusResponse {
  readonly staged: readonly StagedOrderWire[]
  readonly exits: readonly RestingExitWire[]
  readonly unguarded: readonly UnguardedPositionWire[]
  /** Names left out of `unguarded` as residue no order could clear. */
  readonly unguardedResidue: readonly string[]
  readonly unmirrored: readonly UnmirroredOrderWire[]
  /** When buying was switched off; absent while it is on. */
  readonly haltedAt?: number
}

/** A cap the re-priced order would break. `limit` and `actual` are on the cap's own scale. */
export interface CapRejectionWire {
  readonly code: 'stake' | 'openTrades' | 'cash' | 'stopLossRequired'
  readonly limit: number
  readonly actual: number
  readonly venue?: string
}

interface OrderFillWire {
  readonly orderId: string
  readonly state: 'live' | 'partially_filled' | 'filled' | 'canceled' | 'mmp_canceled'
  readonly averagePrice: number
  readonly filledQuantity: number
  /** Positive: what the exchange charged, in `feeCurrency`. */
  readonly fee: number
  readonly feeCurrency: string
  readonly filledAt?: number
}

/** POST /v1/trade/staged/:token/confirm. `unknown-token`: used, discarded or expired; nothing was
 *  placed. `rejected`: a cap refused it on the re-price, and the token is spent. */
export type ConfirmOrderResponse =
  | { readonly kind: 'unknown-token' }
  | {
      readonly kind: 'rejected'
      readonly order: StagedOrderWire
      readonly rejections: readonly CapRejectionWire[]
    }
  | {
      readonly kind: 'executed'
      readonly order: StagedOrderWire
      readonly fill: OrderFillWire
      /** The market's currency the fill and the ledger row are in. */
      readonly currency: string
      readonly exitPlaced: boolean
      /** An exit was asked for and did not go out: the position is unprotected. */
      readonly exitFailure?: { readonly code: string; readonly text: string }
    }

/** POST /v1/trade/exits */
export interface SetExitBody {
  readonly ticker: string
  readonly venue?: string
  readonly takeProfit?: number
  readonly stopLoss?: number
  /** Absent covers the whole position. */
  readonly quantity?: number
}

export interface ExitResponse {
  readonly action: 'placed' | 'amended'
  readonly instrument: InstrumentRefWire
  readonly venue: string
  readonly currency: string
  readonly quantity: number
  /** What the venue holds that the exit does not cover. */
  readonly uncovered: number
  readonly takeProfit?: number
  readonly stopLoss?: number
}

/** POST /v1/trade/halt */
export interface HaltBody {
  readonly halted: boolean
}

/** An exit resting at a venue that no row here tracks, so nothing checks or reports it. A reconcile
 *  only lists it: the exchange's own app is where it is cancelled. */
export interface OrphanExitWire {
  readonly venue: string
  /** The exchange's own name for the instrument. */
  readonly symbol: string
  readonly exitId: string
  readonly quantity: number
  readonly takeProfit?: number
  readonly stopLoss?: number
}

/** POST /v1/trade/reconcile: `settled` rows the book already held were cleared. `unreadExitVenues`
 *  are the venues whose resting exits could not be listed, so an empty `orphanExits` says nothing
 *  about them. */
export interface ReconcileOrdersResponse {
  readonly settled: number
  readonly outstanding: readonly UnmirroredOrderWire[]
  readonly orphanExits: readonly OrphanExitWire[]
  readonly unreadExitVenues: readonly string[]
}

/** Discard, cancel an exit, clear an unmirrored row: `ok` false when there was nothing to act on. */
export interface TradeActionResponse {
  readonly ok: boolean
}
