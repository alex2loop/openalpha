import type { CapRejection, OrderSide, OrderType } from '@/trading/features/order/types'
import type { OrderPolicy } from '@/trading/kernel/config'
import type { CurrencyCode, VenueRef } from '@/trading/kernel/instrument'
import type { Book } from '@/trading/kernel/operator/book'
import type { TradeCost } from '@/trading/markets/cost'
import { resolveBuyCash } from '@/trading/features/ledger/currency-cash'
import { cashDrawMultiple } from '@/trading/markets/cost'

interface CapInput {
  readonly policy: OrderPolicy
  readonly side: OrderSide
  /** Estimated notional in the market's quote currency. */
  readonly notional: number
  readonly currency: CurrencyCode
  /** The same notional converted to the book's base currency. */
  readonly notionalBase: number
  readonly orderType: OrderType
  readonly cost?: TradeCost
  readonly book: Book
  /** The base-currency cost of orders that placed and never reached the book, whole-book. */
  readonly unmirroredSpentBase: number
  readonly venue: VenueRef
  readonly openTrades: number
  /** False for a buy that adds to a held name: the open-trade ceiling counts positions, not fills. */
  readonly opensPosition: boolean
  readonly hasStopLoss: boolean
}

interface CashDraw {
  readonly available: number
  readonly needed: number
  readonly currency: CurrencyCode
}

interface ExitBounds {
  readonly reference: number
  readonly takeProfit?: number
  readonly stopLoss?: number
}

/** Collects reasons and never throws for a policy miss, so it cannot use the ledger's `assert*`
 *  helpers: a thrown `ValidationError` is not a rejection reason. */
export function validateOrderCaps(input: CapInput): readonly CapRejection[] {
  const rejections: CapRejection[] = []
  const { policy } = input

  // Every cap bounds what a buy may add. A sell takes exposure off, so a book at its position
  // count or a large position must still be allowed to close.
  if (input.side !== 'buy') {
    return rejections
  }

  if (policy.maximumStakeQuote > 0 && input.notional > policy.maximumStakeQuote) {
    rejections.push({
      code: 'stake',
      limit: policy.maximumStakeQuote,
      actual: input.notional,
      currency: input.currency,
    })
  }

  if (
    input.opensPosition &&
    policy.maximumOpenTrades > 0 &&
    input.openTrades >= policy.maximumOpenTrades
  ) {
    rejections.push({
      code: 'openTrades',
      limit: policy.maximumOpenTrades,
      actual: input.openTrades,
    })
  }

  const cash = cashDraw(input)

  if (cash.needed > cash.available) {
    rejections.push({
      code: 'cash',
      limit: cash.available,
      actual: cash.needed,
      venue: input.venue,
      currency: cash.currency,
    })
  }

  if (policy.requireStopLoss && !input.hasStopLoss) {
    rejections.push({ code: 'stopLossRequired', limit: 0, actual: 0 })
  }

  return rejections
}

/** The cash a buy draws (quantity times price plus the fee, and the confirm's drift on a market
 *  order) against the cash the ledger would pay it from, both in one currency: the venue's own cash
 *  in the order's currency when it holds some, else its base cash. The unmirrored spend is
 *  whole-book on purpose: it can only refuse, never admit, an order the book could not afford. */
function cashDraw(input: CapInput): CashDraw {
  const drift = input.orderType === 'market' ? input.policy.maximumPriceDrift : 0
  const multiple = cashDrawMultiple(input.cost, drift)
  const buyCash = resolveBuyCash(input.book, input.venue, input.currency)
  const rate = input.notional > 0 ? input.notionalBase / input.notional : 0

  if (buyCash.kind === 'currency' && rate > 0) {
    return {
      available: buyCash.cash.available - input.unmirroredSpentBase / rate,
      needed: input.notional * multiple,
      currency: input.currency,
    }
  }

  return {
    available: buyCash.availableBase - input.unmirroredSpentBase,
    needed: input.notionalBase * multiple,
    currency: input.book.baseCurrency,
  }
}

/** An exit only ever exits a long, so direction is `stopLoss < reference < takeProfit` with no
 *  side to branch on. A swapped pair fires the moment it is placed and OKX accepts it silently. */
export function isExitInverted(input: ExitBounds): boolean {
  const aboveOk = input.takeProfit === undefined || input.takeProfit > input.reference
  const belowOk = input.stopLoss === undefined || input.stopLoss < input.reference

  return !(aboveOk && belowOk)
}
