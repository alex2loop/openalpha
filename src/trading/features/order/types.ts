import type { ApprovalMode } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { LedgerWriteResult } from '@/trading/features/ledger/types'
import type {
  CurrencyCode,
  InstrumentRef,
  Ticker,
  TradingDay,
  VenueRef,
} from '@/trading/kernel/instrument'
import type { StopCover } from '@/trading/kernel/operator/alert'
import type { CapBreach } from '@/trading/kernel/operator/exposure'
import type {
  ExitReceipt,
  OrderReceipt,
  OrderSide,
  OrderType,
} from '@/trading/kernel/venue/spot-adapter'
import { AppError } from '@/core/errors'
import { formatQuantity } from '@/trading/render/format'

export const TRADE_COMMAND_NAME = 'trade'
export const ORDER_TOOL_NAME = 'order_place'

export type {
  ExitReceipt,
  InstrumentLimits,
  OrderReceipt,
  OrderSide,
  OrderType,
} from '@/trading/kernel/venue/spot-adapter'

type OrderErrorCode =
  | 'order.auth'
  | 'order.network'
  | 'order.rate_limited'
  | 'order.insufficient'
  | 'order.rejected'
  | 'order.quote_not_live'
  | 'order.fill_timeout'
  | 'order.unfilled'
  | 'order.clock_skew'
  | 'order.venue_ambiguous'
  | 'order.venue_unavailable'
  | 'order.venue_unreachable'
  | 'order.below_minimum'
  | 'order.exit_below_minimum'
  | 'order.sell_unsettled'
  | 'order.sell_guarded'
  | 'order.approval_bypassed'
  | 'order.buying_halted'
  | 'order.exit_inverted'
  | 'order.exit_failed'
  | 'order.no_position'
  | 'order.exit_conflict'
  | 'order.unmirrorable_fee'
  | 'order.fee_unreported'
  | 'order.unpriced_fill'
  | 'order.unmirrorable'
  | 'order.book_moved'
  | 'order.book_unpriced'
  | 'order.exit_oversized'
  | 'order.exit_unsupported'
  | 'order.exit_not_amendable'

/** Subclassed here rather than in `core/errors.ts`: `core` stays finance-vocab-free, and `AppError`
 *  is exported precisely so a domain can name its own failures. */
export class OrderError extends AppError {
  constructor(
    readonly code: OrderErrorCode,
    message: string,
    cause?: unknown
  ) {
    super(message, cause)
  }

  /** What follows the code's sentence for the operator. The message is also what a tool failure
   *  hands an agent, so it carries no figure the agent may not see. */
  detail(_locale: Locale): string {
    return this.message
  }
}

/** A refusal whose fix is a quantity the operator holds. It rides here, never in `message`, and
 *  only `detail` writes it. */
export class OrderQuantityError extends OrderError {
  constructor(
    code: OrderErrorCode,
    message: string,
    readonly quantity: number
  ) {
    super(code, message)
  }

  override detail(locale: Locale): string {
    return formatQuantity(locale, this.quantity)
  }
}

export interface ExitLevels {
  readonly takeProfit?: number
  readonly stopLoss?: number
}

/** The exit pair as one value, absent when neither level was given, so no caller has to count keys
 *  to learn whether an exit was asked for. */
export function exitLevelsOf(levels: {
  readonly takeProfit?: number | undefined
  readonly stopLoss?: number | undefined
}): ExitLevels | undefined {
  const exit = {
    ...(levels.takeProfit === undefined ? {} : { takeProfit: levels.takeProfit }),
    ...(levels.stopLoss === undefined ? {} : { stopLoss: levels.stopLoss }),
  }

  return Object.keys(exit).length === 0 ? undefined : exit
}

export interface OrderRequest {
  readonly ticker: Ticker
  /** Which exchange to place on. Absent leaves it to routing, which answers only when exactly one
   *  venue could fill the order. */
  readonly venue?: VenueRef
  readonly side: OrderSide
  readonly orderType: OrderType
  readonly quantity: number
  readonly limitPrice?: number
  readonly exit?: ExitLevels
}

export interface RestingExit {
  readonly exitClientId: string
  readonly exitId: string
  readonly symbol: string
  /** Which exchange holds it. An exit that cannot say is unreconcilable. */
  readonly venue: VenueRef
  readonly instrument: InstrumentRef
  readonly quantity: number
  readonly takeProfit?: number
  readonly stopLoss?: number
  /** When the exchange first denied this order exists, absent while it answers. Cleared on any
   *  reply, so the grace period measures one unbroken run of denials and not a lifetime tally. */
  readonly firstMissedAt?: number
  readonly placedAt: number
}

/** A row the operator still has to settle against the ledger: `filledQuantity` falls under
 *  `quantity` when the rest was cancelled, and with no `orderId` nobody knows what filled. */
export interface UnmirroredIntent {
  readonly token: string
  readonly instrument: InstrumentRef
  readonly venue: VenueRef
  readonly side: OrderSide
  readonly quantity: number
  readonly createdAt: number
  readonly failure: string
  readonly orderId?: string
  readonly filledQuantity?: number
  readonly averagePrice?: number
}

/** The operator's terms as they were staged. Never the verdict: quote, drift and caps are re-run
 *  at confirm, because minutes pass between the two. */
export interface StagedOrder {
  readonly token: string
  readonly clientOrderId: string
  readonly instrument: InstrumentRef
  readonly venue: VenueRef
  readonly symbol: string
  readonly side: OrderSide
  readonly orderType: OrderType
  readonly quantity: number
  readonly limitPrice?: number
  readonly takeProfit?: number
  readonly stopLoss?: number
  readonly quotePrice: number
  /** The estimated notional in the book's currency, so a placed order the ledger has not yet seen
   *  still counts against the cash a later order may spend. */
  readonly notionalBase: number
  readonly createdAt: number
}

export interface ExecutedOrder {
  readonly receipt: OrderReceipt
  readonly write: LedgerWriteResult
  readonly exit?: ExitReceipt
  /** Present when an exit was asked for and did not go out; the position is unprotected. */
  readonly exitFailure?: OrderErrorCode
}

export interface PrepareInput {
  readonly request: OrderRequest
  /** The quote the operator was shown when the order was staged, present only at confirm. A market
   *  order names no price of its own, so this is what the live one is held against. */
  readonly stagedQuote?: number
  readonly now: number
  readonly signal: AbortSignal
}

export interface StageOrderInput {
  readonly request: OrderRequest
  readonly prepared: PreparedOrder
  /** The surface's identity for this intent: the confirmation token and the exchange's
   *  `clientOrderId` once hashed are both derived from this one value. The ledger row is keyed by
   *  the venue's order id instead, once the exchange has named one. */
  readonly token: string
  readonly now: number
  readonly signal: AbortSignal
}

interface ClaimInput {
  readonly token: string
  readonly now: number
  readonly signal: AbortSignal
}

interface TradeStatusInput {
  readonly now: number
  readonly signal: AbortSignal
}

export interface ExecuteInput {
  readonly staged: StagedOrder
  readonly prepared: PreparedOrder
  /** Passed in, never read: the service cannot see the run, and a default here would be a default
   *  answer to "was anyone asked". */
  readonly approvalMode: ApprovalMode
  readonly now: number
  readonly signal: AbortSignal
}

export interface CancelExitRequest {
  readonly ticker: Ticker
  /** Which venue's resting exit to cancel. Absent answers only while one is live. */
  readonly venue?: VenueRef
  readonly now: number
  readonly signal: AbortSignal
}

export interface SetExitRequest {
  readonly ticker: Ticker
  /** Which venue's position to guard. Absent answers only while one venue holds it. */
  readonly venue?: VenueRef
  readonly exit: ExitLevels
  /** How much of the position to guard. Absent covers all of it, which is what an operator who
   *  names no size means; a size above what the venue holds is refused rather than trimmed. */
  readonly quantity?: number
  /** Names this operator request, so a retry of it re-derives the client id the first attempt
   *  placed under and finds that exit instead of resting a second one. A surface that can only mint
   *  a fresh one per dispatch gets no such retry; a new request must carry a new id. */
  readonly requestId: string
  readonly now: number
  readonly signal: AbortSignal
}

/** What the exit looks like once it is live, and whether it was set or moved — the surface says
 *  different things for the two, and nothing else distinguishes them. */
export interface ExitOutcome {
  readonly action: 'placed' | 'amended'
  readonly venue: VenueRef
  readonly instrument: InstrumentRef
  /** What the levels are quoted in, so the surface prints a trigger the same way a receipt does. */
  readonly currency: CurrencyCode
  readonly quantity: number
  /** What this venue holds that the exit does not cover. Zero on a whole-position exit, which is
   *  most of them; above zero the surface has to say so, because nothing else will. */
  readonly uncovered: number
  readonly takeProfit?: number
  readonly stopLoss?: number
}

/** What the caps were measured against, carried so the surface renders the same numbers the policy
 *  read rather than fetching a second quote of its own. */
export interface PreparedOrder {
  readonly instrument: InstrumentRef
  /** Where this order was routed. The prompt, the fee rate and the mirrored row all read it here
   *  rather than re-deriving it, so the confirm cannot land on a different exchange. */
  readonly venue: VenueRef
  readonly symbol: string
  readonly day: TradingDay
  readonly quantity: number
  readonly limitPrice?: number
  /** On the venue's price grid, so the prompt shows the levels that will actually rest. */
  readonly exit?: ExitLevels
  readonly quotePrice: number
  readonly notional: number
  readonly notionalBase: number
  /** The market's own currency, which is what a ledger row is denominated in — never the exchange's
   *  settlement asset. */
  readonly currency: CurrencyCode
  readonly rejections: readonly CapRejection[]
  /** Ceilings this buy would cross, stated on the prompt and never enforced: the operator overriding
   *  their own cap is what approving an order means. Always empty on a sell, which takes exposure
   *  off. */
  readonly breaches: readonly CapBreach[]
}

export interface CapRejection {
  readonly code: 'stake' | 'openTrades' | 'cash' | 'stopLossRequired'
  readonly limit: number
  readonly actual: number
  /** Which venue's cash the `cash` arm measured. Absent on every other code: a stake ceiling and an
   *  open-position count are whole-book figures and naming a venue beside them would be wrong. */
  readonly venue?: VenueRef
}

/** A resting exit with the currency its levels are quoted in. The row itself cannot say — the
 *  market owns that, and only the registry can ask it. Absent where the registry no longer lists
 *  the market, which prints the levels bare rather than dropping a live exit from the list. */
export interface RestingExitRow extends RestingExit {
  readonly currency?: CurrencyCode
}

/** How much of one position has an exit standing at it. A fraction of the position and never a
 *  quantity, because a unit count is book size an agent may not see — the same reason the portfolio
 *  has a relative view at all. */
export interface ExitCoverage {
  readonly instrument: InstrumentRef
  readonly venue: VenueRef
  /** 1 where the whole position is covered, 0 where nothing stands under it. */
  readonly guardedShare: number
  readonly takeProfit?: number
  readonly stopLoss?: number
}

/** A position at a venue with less exit standing at it than the book says is held. Both figures,
 *  because partly guarded and not guarded at all are different situations and the remedy names a
 *  size. Only ever a venue this tree can place at — nothing can rest at a hand-held custodian. */
export interface UnguardedPosition {
  readonly instrument: InstrumentRef
  readonly venue: VenueRef
  readonly quantity: number
  readonly guarded: number
}

export interface HaltInput {
  readonly halted: boolean
  readonly now: number
  readonly signal: AbortSignal
}

/** Everything outstanding, in one read: orders staged and not yet confirmed, exits resting at a
 *  venue, positions nothing is guarding, and what the exchange took that the book never got. Each
 *  list is bounded, because this is read to decide what to do next rather than to inventory a
 *  desk. */
export interface TradeStatus {
  readonly staged: readonly StagedOrder[]
  readonly exits: readonly RestingExitRow[]
  readonly unguarded: readonly UnguardedPosition[]
  /** Names held back from `unguarded` as residue no order could clear, so the section can say how
   *  many it did not list rather than dropping them in silence. */
  readonly unguardedResidue: readonly string[]
  readonly unmirrored: readonly UnmirroredIntent[]
  /** When the operator switched buying off. Absent while buying is on. */
  readonly haltedAt?: number
}

/** An exit resting at a venue under this tree's client id shape that no live row names, so the exit
 *  tick cannot see it. */
export interface OrphanExit {
  readonly venue: VenueRef
  readonly symbol: string
  readonly exitId: string
  readonly quantity: number
  readonly takeProfit?: number
  readonly stopLoss?: number
}

/** What a reconcile pass found. `settled` counts rows cleared without asking, because the book was
 *  shown to hold that exact exchange order; `outstanding` is what only the operator can judge. */
export interface UnmirroredReview {
  readonly settled: number
  readonly outstanding: readonly UnmirroredIntent[]
}

/** `/trade reconcile`: the rows above plus the exits resting at a venue. `orphanExits` is reported
 *  and never acted on, and `unreadExitVenues` names the venues whose exits could not be listed,
 *  because a venue that was not read has no orphans to report. */
export interface ReconcileReview extends UnmirroredReview {
  readonly orphanExits: readonly OrphanExit[]
  readonly unreadExitVenues: readonly VenueRef[]
}

/** What a confirm did. `rejected`: the re-price refused it, and the token is spent. */
export type ConfirmOutcome =
  | { readonly kind: 'unknown-token' }
  | {
      readonly kind: 'rejected'
      readonly staged: StagedOrder
      readonly prepared: PreparedOrder
    }
  | {
      readonly kind: 'executed'
      readonly staged: StagedOrder
      readonly prepared: PreparedOrder
      readonly executed: ExecutedOrder
    }

/** Consumer-side: `command.ts` and `tools.ts` program to this, `execute.ts` implements it, and
 *  composition binds it. */
export interface OrderService {
  prepare(input: PrepareInput): Promise<PreparedOrder>
  stage(input: StageOrderInput): Promise<StagedOrder>
  execute(input: ExecuteInput): Promise<ExecutedOrder>
  claim(input: ClaimInput): Promise<StagedOrder | undefined>
  /** Claims the token, prices the order again and places it when nothing refuses it now. */
  confirm(input: ClaimInput): Promise<ConfirmOutcome>
  /** Drops a staged order unplaced; false when the token names none still quotable. */
  discard(input: ClaimInput): Promise<boolean>
  /** What is outstanding right now. Reads no venue, so it answers while an exchange is down. */
  tradeStatus(input: TradeStatusInput): Promise<TradeStatus>
  /** Whether each position has an exit standing at it, in the terms an agent may see. */
  exitCoverage(input: TradeStatusInput): Promise<readonly ExitCoverage[]>
  /** Per instrument the book could place a stop for, whether one is standing at every venue holding
   *  it. What lets a surface printing a planned stop say whether anything is behind it. */
  restingStops(input: TradeStatusInput): Promise<ReadonlyMap<string, StopCover>>
  /** False when there was no resting exit, so the surface renders its own arm rather than
   *  reporting a cancel that did not happen. */
  /** Sets or moves the resting exit on a position the book already holds, covering all of it
   *  unless a smaller size is named. Never removes one: a request that cannot be amended into the
   *  resting exit is refused rather than replaced. */
  setExit(input: SetExitRequest): Promise<ExitOutcome>
  cancelExit(input: CancelExitRequest): Promise<boolean>
  /** What the exchange took and the ledger never received. Rows the book has since recovered are
   *  cleared here; the rest keep counting against the caps until the operator settles them. */
  reconcileUnmirrored(signal: AbortSignal): Promise<UnmirroredReview>
  /** `reconcileUnmirrored` plus the exits resting at a venue that no row tracks, which it lists
   *  and never cancels. Reads every exit-resting venue, so it is for an operator's reconcile and
   *  not a loop. */
  reconcileOrders(signal: AbortSignal): Promise<ReconcileReview>
  /** False when the token names no outstanding row. */
  clearUnmirrored(token: string, signal: AbortSignal): Promise<boolean>
  /** Switches buying off or back on. Sells, exits and cancels are never affected. */
  setHalted(input: HaltInput): Promise<void>
}
