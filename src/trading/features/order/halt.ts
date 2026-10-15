import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type { HaltInput, OrderSide } from '@/trading/features/order/types'
import { OrderError } from '@/trading/features/order/types'

/** Only a buy adds risk. A sale, an exit and a cancel take it off, so a halt never blocks them and
 *  never touches what is already resting at a venue. */
export async function assertBuyingAllowed(
  deps: OrderServiceDeps,
  side: OrderSide,
  signal: AbortSignal
): Promise<void> {
  if (side !== 'buy' || (await deps.settings.haltedAt(signal)) === undefined) {
    return
  }

  throw new OrderError('order.buying_halted', 'buying is halted until the operator resumes it')
}

export async function setHalted(deps: OrderServiceDeps, input: HaltInput): Promise<void> {
  await deps.settings.setHalted(input)

  if (input.halted) {
    deps.logger.info('order.buying_halted', { at: input.now })
  } else {
    deps.logger.info('order.buying_resumed', { at: input.now })
  }
}
