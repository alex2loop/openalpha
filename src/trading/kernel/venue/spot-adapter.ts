import type { InstrumentRef } from '@/trading/kernel/instrument'

export const ORDER_SIDES = Object.freeze(['buy', 'sell'] as const)
const ORDER_TYPES = Object.freeze(['market', 'limit'] as const)

export type OrderSide = (typeof ORDER_SIDES)[number]
export type OrderType = (typeof ORDER_TYPES)[number]

/** Terminal states end the poll; `live` at the cap is a fill timeout, not a rejection. */
export type OrderState = 'live' | 'partially_filled' | 'filled' | 'canceled' | 'mmp_canceled'

/** The exchange's constraints on an order, never this tree's identity for the asset. */
export interface InstrumentLimits {
  readonly symbol: string
  readonly lotSize: number
  readonly minimumSize: number
  readonly tickSize: number
}

/** One asset the venue says it holds, named as the venue names it. Absent from a venue's list means
 *  held at zero, never unknown. */
export interface VenueBalance {
  readonly asset: string
  readonly quantity: number
}

export interface OrderReceipt {
  readonly orderId: string
  readonly symbol: string
  /** Which way the order went. Every caller that placed one already knows; an enumerated fill does
   *  not, and no arithmetic recovers it. */
  readonly side: OrderSide
  readonly state: OrderState
  /** The order's average fill price, never one fill's `fillPx`. */
  readonly averagePrice: number
  /** Accumulated fill quantity in base currency, never one fill's `fillSz`. */
  readonly filledQuantity: number
  /** A charge is reported negative; the sign is preserved here and taken absolute at the mirror. */
  readonly fee: number
  readonly feeCurrency: string
  /** The last fill's stamp, from the venue's clock. What dates an exit — absent when the
   *  venue named none, because a local clock would date the trade to the day it was noticed. */
  readonly filledAt?: number
}

export interface ExitReceipt {
  readonly exitId: string
  readonly exitClientId: string
}

export interface PlaceOrderInput {
  readonly symbol: string
  readonly side: OrderSide
  readonly orderType: OrderType
  readonly size: number
  readonly limitPrice?: number
  readonly clientOrderId: string
  readonly signal: AbortSignal
}

export interface OrderLookup {
  readonly symbol: string
  readonly orderId?: string
  readonly clientOrderId?: string
  readonly signal: AbortSignal
}

/** Every order of any symbol that filled at or after `since`. The unqualified counterpart of
 *  `FilledOrderLookup`: it answers what the venue traded, rather than what it traded in one name.
 *  `symbols` are the venue symbols the book has recorded here. A venue that can only list one symbol
 *  at a time reads these plus whatever it holds now; one that lists everything ignores them. */
export interface FilledOrderWindow {
  readonly since: number
  readonly symbols: readonly string[]
  readonly signal: AbortSignal
}

/** Every order of one side on one symbol that filled at or after `since`. Bounded by the venue's
 *  own history window, which is why a trade recorded long after it happened finds nothing. */
export interface FilledOrderLookup {
  readonly symbol: string
  readonly side: OrderSide
  readonly since: number
  readonly signal: AbortSignal
}

export interface CancelOrderInput {
  readonly symbol: string
  readonly orderId: string
  readonly signal: AbortSignal
}

export interface PlaceExitInput {
  readonly symbol: string
  readonly size: number
  readonly takeProfit?: number
  readonly stopLoss?: number
  readonly exitClientId: string
  readonly signal: AbortSignal
}

export interface ExitLookup {
  readonly symbol: string
  readonly exitClientId: string
  readonly signal: AbortSignal
}

/** An exit resting at the venue, as the venue reports it. Levels are absent on a leg the exit does
 *  not carry. */
export interface OpenExit {
  readonly symbol: string
  readonly exitId: string
  readonly exitClientId: string
  readonly size: number
  readonly takeProfit?: number
  readonly stopLoss?: number
}

export interface CancelExitInput {
  readonly symbol: string
  readonly exitId: string
  readonly signal: AbortSignal
}

/** New levels and size for an exit already resting. The leg shape is fixed at placement — an exit
 *  placed with a stop alone cannot grow a take-profit — so the caller refuses that case rather than
 *  sending a change the venue would reject. */
export interface AmendExitInput {
  readonly symbol: string
  readonly exitId: string
  readonly size: number
  readonly takeProfit?: number
  readonly stopLoss?: number
  readonly signal: AbortSignal
}

/** What a resting exit reports about itself. `triggered` with no fill, or with a fill whose order is
 *  still working, is a trigger mid-flight — the next pass reads it — so a caller never learns
 *  whether the venue models the fill as a separate order or reports it inline. */
export interface ExitStatus {
  readonly state: 'live' | 'triggered' | 'canceled' | 'failed'
  readonly fill?: OrderReceipt
  /** What cancel and amend address, reported while `live` so a placement whose answer was lost can
   *  be adopted by the id it was placed under. */
  readonly exitId?: string
}

export interface SpotAdapter {
  /** What this venue settles a spot pair in, so a fee charged in the asset received can be told
   *  from one charged in the money paid. */
  readonly quoteAsset: string
  /** The pair convention is the venue's own: `BTC` becomes `BTC-USDT` on OKX and `BTCUSDT`
   *  elsewhere. Nothing outside a venue folder builds an exchange symbol. */
  toSymbol(instrument: InstrumentRef): string
  /** The inverse of `toSymbol`: the base asset a venue symbol names, or undefined when the symbol
   *  is not one this venue settles in `quoteAsset`. */
  toTicker(symbol: string): string | undefined
  /** An id for an order this tree mints, in whatever shape the venue's API accepts. Deterministic,
   *  so a retry re-derives the same one rather than placing a second order. */
  toClientOrderId(key: string): string
  assertClockInSync(signal: AbortSignal): Promise<void>
  fetchLimits(symbol: string, signal: AbortSignal): Promise<InstrumentLimits>
  placeOrder(input: PlaceOrderInput): Promise<string>
  /** Undefined when the venue knows no such order, which is what separates a lost response from a
   *  request that never arrived. */
  fetchOrder(lookup: OrderLookup): Promise<OrderReceipt | undefined>
  /** What the venue actually filled, for a trade this tree never placed. It is how a hand-made
   *  trade is recorded from the exchange's own figures rather than the operator's recollection. */
  fetchFilledOrders?(lookup: FilledOrderLookup): Promise<readonly OrderReceipt[]>
  /** Every fill in the window, across every symbol. Bounded by the venue's own history window, so a
   *  window reaching further back returns only what the venue still keeps. */
  listFilledOrders?(window: FilledOrderWindow): Promise<readonly OrderReceipt[]>
  /** What one asset is worth in `quoteAsset` here. Asked only to price a fee the venue charged in
   *  neither leg of the pair; undefined when it lists no such pair. */
  fetchAssetPrice(asset: string, signal: AbortSignal): Promise<number | undefined>
  /** Everything the venue holds, so the book can be held against the custodian rather than against
   *  itself. No order path calls it. */
  fetchBalances?(signal: AbortSignal): Promise<readonly VenueBalance[]>
  /** Settles quietly when the order already filled or was already cancelled; the caller reads the
   *  order back to learn which. */
  cancelOrder(input: CancelOrderInput): Promise<void>
  placeExit?(input: PlaceExitInput): Promise<ExitReceipt>
  /** Moves a resting exit in place. A venue that refuses the change leaves the old exit live, which
   *  is why this is preferred over cancelling and placing again. */
  amendExit?(input: AmendExitInput): Promise<void>
  fetchExit?(lookup: ExitLookup): Promise<ExitStatus | undefined>
  cancelExit?(input: CancelExitInput): Promise<void>
  /** Every exit resting under a client id of the shape `toClientOrderId` mints, whoever's row it is
   *  and across every symbol. That shape is how an exit this tree placed is told from one set in the
   *  exchange's own app, which this tree must neither claim nor report. Rejects when the venue
   *  cannot be read: an empty list is an answer, never a failure's stand-in. */
  listOpenExits?(signal: AbortSignal): Promise<readonly OpenExit[]>
  /** The symbols carrying a live sell stop on the account, whoever placed it, so a stop the operator
   *  set in the exchange's app is not reported as missing. */
  listStopSymbols?(signal: AbortSignal): Promise<ReadonlySet<string>>
}
