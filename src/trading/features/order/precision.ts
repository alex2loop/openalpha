import type { ExitLevels, InstrumentLimits } from '@/trading/features/order/types'
import type { OrderSide } from '@/trading/kernel/venue/spot-adapter'
import { OrderError } from '@/trading/features/order/types'
import { roundToStep, STEP_DIGITS } from '@/trading/kernel/instrument'

/** The finest step that arithmetic can settle on, and the floor the ledger's dust epsilon sits
 *  below. A venue quoting finer would round every order to a size nobody asked for and leave
 *  residues the book reads as flat. */
const MINIMUM_STEP = 10 ** -STEP_DIGITS

interface RoundedOrder {
  readonly quantity: number
  readonly limitPrice?: number
}

interface LimitTerms {
  readonly price: number
  readonly side: OrderSide
}

interface RoundInput {
  readonly limits: InstrumentLimits
  readonly quantity: number
  readonly limit?: LimitTerms
}

/** Runs before pricing, before caps and before the operator sees anything, so the drift check, the
 *  notional, the prompt and the submitted `sz` are all the same number. */
export function roundToInstrument(input: RoundInput): RoundedOrder {
  assertStepsRepresentable(input.limits)

  const quantity = roundToStep(input.quantity, input.limits.lotSize, 'down')

  if (quantity < input.limits.minimumSize) {
    throw new OrderError(
      'order.below_minimum',
      `${input.limits.symbol} minimum order size is ${input.limits.minimumSize}`
    )
  }

  // Toward the operator: a buy never pays above the typed limit, a sell never takes below it.
  const limitPrice =
    input.limit === undefined
      ? undefined
      : roundToStep(
          input.limit.price,
          input.limits.tickSize,
          input.limit.side === 'buy' ? 'down' : 'up'
        )

  return { quantity, ...(limitPrice === undefined ? {} : { limitPrice }) }
}

/** A venue refuses a trigger off its price grid, and a coarser grid than the plan's is common. Each
 *  level rounds away from the price, so neither can cross it and fire the moment it rests: the
 *  cost is a stop at most one step wider, which still guards the position a refused one would not. */
export function roundExitLevels(limits: InstrumentLimits, exit: ExitLevels): ExitLevels {
  return {
    ...(exit.takeProfit === undefined
      ? {}
      : { takeProfit: roundToStep(exit.takeProfit, limits.tickSize, 'up') }),
    ...(exit.stopLoss === undefined
      ? {}
      : { stopLoss: roundToStep(exit.stopLoss, limits.tickSize, 'down') }),
  }
}

/** Refused rather than rounded: an instrument quoted finer than the arithmetic below can hold would
 *  silently trade a different size, and its residue would sit under the dust epsilon that decides a
 *  position is closed. */
function assertStepsRepresentable(limits: InstrumentLimits): void {
  if (limits.lotSize < MINIMUM_STEP || limits.tickSize < MINIMUM_STEP) {
    throw new OrderError(
      'order.rejected',
      `${limits.symbol} quotes steps finer than ${MINIMUM_STEP}`
    )
  }
}
