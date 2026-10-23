import type { CapRejection, OrderSide, OrderType } from '@/trading/features/order/types'
import type { OrderPolicy } from '@/trading/kernel/config'
import type { VenueRef } from '@/trading/kernel/instrument'
import type { TradeCost } from '@/trading/markets/cost'

interface CapInput {
  readonly policy: OrderPolicy
  readonly side: OrderSide
  /** Estimated notional in the market's quote currency. */
  readonly notional: number
  /** The same notional converted to the book's base currency. */
  readonly notionalBase: number
  readonly orderType: OrderType
  readonly cost?: TradeCost
  readonly availableCashBase: number
  readonly venue: VenueRef
  readonly openTrades: number
  /** False for a buy that adds to a held name: the open-trade ceiling counts positions, not fills. */
  readonly opensPosition: boolean
  readonly hasStopLoss: boolean
}

interface ExitBounds {
  readonly reference: number
  readonly takeProfit?: number
  readonly stopLoss?: number
}

/** Collects reasons and never throws for a policy miss, so it cannot use the ledger's `assert*`
 *  helpers: a thrown `ValidationError` is not a rejection reason. `availableCashBase` is in the
 *  book's currency and `notional` is in the market's, so the caller converts before it compares. */
export function validateOrderCaps(input: CapInput): readonly CapRejection[] {
  const rejections: CapRejection[] = []
  const { policy } = input

  // Every cap bounds what a buy may add. A sell takes exposure off, so a book at its position
  // count or a large position must still be allowed to close.
  if (input.side !== 'buy') {
    return rejections
  }

  if (policy.maximumStakeQuote > 0 && input.notional > policy.maximumStakeQuote) {
    rejections.push({ code: 'stake', limit: policy.maximumStakeQuote, actual: input.notional })
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

  const cashNeeded = cashNeededBase(input)

  if (cashNeeded > input.availableCashBase) {
    rejections.push({
      code: 'cash',
      limit: input.availableCashBase,
      actual: cashNeeded,
      venue: input.venue,
    })
  }

  if (policy.requireStopLoss && !input.hasStopLoss) {
    rejections.push({ code: 'stopLossRequired', limit: 0, actual: 0 })
  }

  return rejections
}

/** The cash a buy draws, which the ledger refuses to book short of: its row costs quantity times
 *  price plus the fee, so a buy sized to the notional alone fills and then cannot be mirrored. A
 *  fee billed in base coins comes out of the quantity and adds nothing here. A market order
 *  carries the drift the confirm tolerates; a limit order never fills above its limit. */
function cashNeededBase(input: CapInput): number {
  const slippage = input.orderType === 'market' ? 1 + input.policy.maximumPriceDrift : 1
  const feeRate = input.cost?.feeAsset === 'quote' ? input.cost.buyRate : 0

  return input.notionalBase * slippage * (1 + feeRate)
}

/** An exit only ever exits a long, so direction is `stopLoss < reference < takeProfit` with no
 *  side to branch on. A swapped pair fires the moment it is placed and OKX accepts it silently. */
export function isExitInverted(input: ExitBounds): boolean {
  const aboveOk = input.takeProfit === undefined || input.takeProfit > input.reference
  const belowOk = input.stopLoss === undefined || input.stopLoss < input.reference

  return !(aboveOk && belowOk)
}
