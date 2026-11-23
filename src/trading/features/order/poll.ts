import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type { RoutedVenue } from '@/trading/features/order/routing'
import type { OrderReceipt, StagedOrder } from '@/trading/features/order/types'
import type { OrderLookup } from '@/trading/kernel/venue/spot-adapter'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { sleep } from '@/core/utils/time'
import { OrderError } from '@/trading/features/order/types'

const ORDER_POLL_INTERVAL_MS = 1_000
const ORDER_POLL_ATTEMPTS = 20
/** Consecutive lookup failures before a live order is abandoned; one miss among twenty polls
 *  says nothing about the order. */
const ORDER_POLL_FAILURE_LIMIT = 3
/** Reads after a cancel, a second apart, for the venue to finish cancelling. */
const CANCEL_CONFIRM_ATTEMPTS = 5

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
  const receipt = await pollForTerminal(deps, input, { lookup, attempts: ORDER_POLL_ATTEMPTS })

  if (receipt === undefined) {
    return await cancelRemainder(deps, input, orderId)
  }

  deps.logger.info('order.filled', {
    clientOrderId: staged.clientOrderId,
    orderId,
    symbol: staged.symbol,
    state: receipt.state,
  })

  return receipt
}

interface PollBudget {
  readonly lookup: OrderLookup
  readonly attempts: number
}

/** Undefined when no terminal state shows within the attempts, a second apart. */
async function pollForTerminal(
  deps: OrderServiceDeps,
  input: SubmitInput,
  budget: PollBudget
): Promise<OrderReceipt | undefined> {
  const { lookup, attempts } = budget
  let consecutiveFailures = 0

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const polled = await pollOnce(deps, input, { lookup, consecutiveFailures })
    consecutiveFailures = polled.consecutiveFailures

    if (polled.receipt !== undefined && isTerminal(polled.receipt.state)) {
      return polled.receipt
    }

    if (attempt < attempts) {
      await sleep(ORDER_POLL_INTERVAL_MS, input.signal)
    }
  }

  return undefined
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
 *  attempt the same way, and twenty identical lines bury the one that explains them. An abort is no
 *  failed lookup: it leaves at once for the caller's own abort handling. */
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
    if (isCallerAbort(input, err)) {
      throw err
    }

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
 *  fails, or is never seen to finish, leaves an order the operator has to reconcile, and says so. An
 *  abort is the caller's own to clean up. */
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
    if (isCallerAbort(input, err)) {
      throw err
    }

    deps.logger.error('order.remainder_cancel_failed', {
      clientOrderId: staged.clientOrderId,
      orderId,
      symbol: staged.symbol,
      err: formatErrForLog(err),
    })

    throw new OrderError('order.fill_timeout', `order ${orderId} is still live`, err)
  }

  // A cancel is a request: the venue may still report the order live while it works through it, and
  // reading that as unfilled would drop a fill that lands a moment later.
  const receipt = await pollForTerminal(deps, input, {
    lookup,
    attempts: CANCEL_CONFIRM_ATTEMPTS,
  })

  if (receipt === undefined) {
    throw new OrderError('order.fill_timeout', `order ${orderId} is not confirmed cancelled`)
  }

  if (receipt.filledQuantity <= 0) {
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

function isCallerAbort(input: SubmitInput, err: unknown): boolean {
  return input.signal.aborted || isAbortError(err)
}
