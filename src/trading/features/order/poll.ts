import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type { RoutedVenue } from '@/trading/features/order/routing'
import type { OrderReceipt, StagedOrder } from '@/trading/features/order/types'
import type { OrderLookup } from '@/trading/kernel/venue/spot-adapter'
import { formatErrForLog } from '@/core/security/credentials'
import { sleep } from '@/core/utils/time'
import { OrderError } from '@/trading/features/order/types'

const ORDER_POLL_INTERVAL_MS = 1_000
const ORDER_POLL_ATTEMPTS = 20
/** Consecutive lookup failures before a live order is abandoned; one miss among twenty polls
 *  says nothing about the order. */
const ORDER_POLL_FAILURE_LIMIT = 3

export interface SubmitInput {
  readonly staged: StagedOrder
  readonly venue: RoutedVenue
  readonly signal: AbortSignal
}

/** A partial fill is not terminal, so the poll continues; at the cap the remainder is cancelled,
 *  because a resting order nobody watches is a standing order. A failed lookup is the network,
 *  not the order: it costs an attempt, not the position. */
export async function pollUntilTerminal(
  deps: OrderServiceDeps,
  input: SubmitInput,
  orderId: string
): Promise<OrderReceipt> {
  const { staged } = input
  const lookup = { symbol: staged.symbol, orderId, signal: input.signal }
  let consecutiveFailures = 0

  for (let attempt = 1; attempt <= ORDER_POLL_ATTEMPTS; attempt += 1) {
    const polled = await pollOnce(deps, input, { lookup, consecutiveFailures })
    consecutiveFailures = polled.consecutiveFailures

    if (polled.receipt !== undefined && isTerminal(polled.receipt.state)) {
      deps.logger.info('order.filled', {
        clientOrderId: staged.clientOrderId,
        orderId,
        symbol: staged.symbol,
        state: polled.receipt.state,
      })

      return polled.receipt
    }

    if (attempt < ORDER_POLL_ATTEMPTS) {
      await sleep(ORDER_POLL_INTERVAL_MS, input.signal)
    }
  }

  return await cancelRemainder(deps, input, orderId)
}

interface PollState {
  readonly lookup: OrderLookup
  readonly consecutiveFailures: number
}

interface PolledOrder {
  readonly receipt?: OrderReceipt
  readonly consecutiveFailures: number
}

/** Reports the first failure of a run and stays quiet after it: a provider that is down fails every
 *  attempt the same way, and twenty identical lines bury the one that explains them. */
async function pollOnce(
  deps: OrderServiceDeps,
  input: SubmitInput,
  state: PollState
): Promise<PolledOrder> {
  const { lookup } = state

  try {
    const receipt = await input.venue.adapter.fetchOrder(lookup)

    return { consecutiveFailures: 0, ...(receipt === undefined ? {} : { receipt }) }
  } catch (err: unknown) {
    const failures = state.consecutiveFailures + 1

    if (failures >= ORDER_POLL_FAILURE_LIMIT) {
      throw err
    }

    if (state.consecutiveFailures === 0) {
      deps.logger.warn('order.poll_lookup_failed', {
        clientOrderId: input.staged.clientOrderId,
        orderId: lookup.orderId,
        symbol: lookup.symbol,
        err: formatErrForLog(err),
      })
    }

    return { consecutiveFailures: failures }
  }
}

function isTerminal(state: OrderReceipt['state']): boolean {
  return state !== 'live' && state !== 'partially_filled'
}

/** Whatever filled between the last poll and the cancel is read back and booked; a cancel that
 *  fails leaves a live order the operator has to reconcile, and says so. */
async function cancelRemainder(
  deps: OrderServiceDeps,
  input: SubmitInput,
  orderId: string
): Promise<OrderReceipt> {
  const { staged } = input
  const lookup = { symbol: staged.symbol, orderId, signal: input.signal }

  try {
    await input.venue.adapter.cancelOrder(lookup)
  } catch (err: unknown) {
    deps.logger.error('order.remainder_cancel_failed', {
      clientOrderId: staged.clientOrderId,
      orderId,
      symbol: staged.symbol,
      err: formatErrForLog(err),
    })

    throw new OrderError('order.fill_timeout', `order ${orderId} is still live`, err)
  }

  const receipt = await input.venue.adapter.fetchOrder(lookup)

  if (receipt === undefined || receipt.filledQuantity <= 0) {
    throw new OrderError('order.unfilled', `order ${orderId} did not fill and was cancelled`)
  }

  deps.logger.info('order.remainder_cancelled', {
    clientOrderId: staged.clientOrderId,
    orderId,
    symbol: staged.symbol,
    filledQuantity: receipt.filledQuantity,
  })

  return receipt
}
