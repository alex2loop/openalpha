import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type { FilledOrder } from '@/trading/features/order/mirror'
import type { SubmitInput } from '@/trading/features/order/poll'
import type {
  CapRejection,
  ExecutedOrder,
  ExecuteInput,
  ExitLevels,
  OrderReceipt,
  OrderService,
} from '@/trading/features/order/types'
import { formatErrForLog } from '@/core/security/credentials'
import { createOrderConfirm } from '@/trading/features/order/confirm'
import {
  assertRestsExits,
  cancelRestingExit,
  placeExit,
  setRestingExit,
} from '@/trading/features/order/exit'
import { assertBookPriced } from '@/trading/features/order/exposure'
import { assertBuyingAllowed, setHalted } from '@/trading/features/order/halt'
import { createOrderIntents } from '@/trading/features/order/intents'
import { mirrorFilledOrder, settleSignal } from '@/trading/features/order/mirror'
import { sweepOrphanExits } from '@/trading/features/order/orphan-exits'
import { pollUntilTerminal } from '@/trading/features/order/poll'
import {
  assertSellable,
  findBuyProfile,
  prepareOrder,
  rejectionsFor,
  stageOrder,
} from '@/trading/features/order/prepare'
import { adapterFor } from '@/trading/features/order/routing'
import { resolveSellableQuantities } from '@/trading/features/order/sellable'
import {
  resolveExitCoverage,
  resolveRestingStops,
  resolveTradeStatus,
} from '@/trading/features/order/status'
import { exitLevelsOf, OrderError } from '@/trading/features/order/types'

/** What a row says when the order left this process and its fate is unknown. Not an `OrderError`
 *  code: those name why one call failed, and this names a row a human still has to close. */
const UNRECONCILED_FAILURE = 'unreconciled'
const REJECTION_SEPARATOR = ', '

export function createOrderService(deps: OrderServiceDeps): OrderService {
  // One write to an exchange at a time. Both races this closes are the same shape — read the state,
  // decide, then act: two orders placing together each measure a book the other has not written to
  // and both clear a whole-book ceiling only one of them may, and two exits set together each read
  // nothing resting and leave behind the second one the conflict guard exists to prevent. The tail
  // is replaced rather than appended, and never carries a rejection forward: one refused write must
  // not refuse the next.
  let writing: Promise<unknown> = Promise.resolve()
  const intents = createOrderIntents(deps)

  const exclusively = async <T>(work: () => Promise<T>): Promise<T> => {
    const next = writing.then(work)

    writing = next.catch(() => undefined)

    return await next
  }

  const service: Omit<OrderService, 'confirm' | 'discard'> = {
    prepare: (input) => prepareOrder(deps, input),
    stage: (input) => stageOrder(deps, input),
    execute: (input) => exclusively(() => execute(deps, input)),
    tradeStatus: (input) => resolveTradeStatus(deps, input),
    exitCoverage: (input) => resolveExitCoverage(deps, input),
    restingStops: (input) => resolveRestingStops(deps, input),
    setExit: (input) => exclusively(() => setRestingExit(deps, input)),
    cancelExit: (input) => exclusively(() => cancelRestingExit(deps, input)),
    reconcileOrders: async (signal) => ({
      ...(await intents.reconcileUnmirrored(signal)),
      ...(await exclusively(() => sweepOrphanExits(deps, signal))),
    }),
    setHalted: (input) => setHalted(deps, input),
    ...intents,
  }

  return { ...service, ...createOrderConfirm(service) }
}

async function execute(deps: OrderServiceDeps, input: ExecuteInput): Promise<ExecutedOrder> {
  // `createApprovalGate` allows on `bypass` before it ever consults `requiresApproval`, so a tool
  // cannot make itself un-bypassable. Refusing here is the only place that can.
  if (input.approvalMode === 'bypass' && !deps.policy.allowUnattended) {
    throw new OrderError('order.approval_bypassed', 'no approval was asked for and none is allowed')
  }

  await assertBuyingAllowed(deps, input.staged.side, input.signal)
  await assertBookStillAllows(deps, input)

  const { staged } = input
  const venue = adapterFor(deps.venues, staged.venue)
  const submitted: SubmitInput = { staged, venue, signal: input.signal }

  await markInFlight(deps, submitted)

  const receipt = await submit(deps, submitted)

  if (receipt.filledQuantity <= 0) {
    await settleUnfilled(deps, submitted, receipt.orderId)

    throw new OrderError('order.rejected', `order ${receipt.orderId} ended as ${receipt.state}`)
  }

  const filled = await mirrorFilledOrder(deps, { input, venue, receipt })
  const executed: ExecutedOrder = { receipt, write: filled.write }
  const exit = exitLevelsOf(staged)

  if (staged.side !== 'buy' || exit === undefined) {
    return executed
  }

  return { ...executed, ...(await attachExit(deps, filled, exit)) }
}

/** The order the operator approved, judged once more against the book as it stands now. Refused
 *  rather than trimmed: the size and the levels are what they said yes to, and an order silently
 *  made smaller is not the one they approved. A sell is checked against the free quantity
 *  instead. */
async function assertBookStillAllows(deps: OrderServiceDeps, input: ExecuteInput): Promise<void> {
  const { staged } = input
  const rejections = await bookCapRejections(deps, input)

  if (rejections.length > 0) {
    throw new OrderError(
      'order.book_moved',
      rejections.map((rejection) => rejection.code).join(REJECTION_SEPARATOR)
    )
  }

  if (staged.side === 'sell') {
    const sellable = await resolveSellableQuantities(deps, {
      instrument: staged.instrument,
      now: input.now,
      signal: input.signal,
    })

    assertSellable(sellable, staged.venue, staged.quantity)
  }
}

/** The caps as they stand now. `prepare` measured them against a book an order still going out
 *  has not written to yet, so the verdict is taken again where nothing else can be placed in
 *  between; otherwise two confirms read one book and both clear a ceiling only one may. A holding
 *  that lost its price since then refuses the buy here too. Every other term is this order's
 *  own. */
async function bookCapRejections(
  deps: OrderServiceDeps,
  input: ExecuteInput
): Promise<readonly CapRejection[]> {
  const { prepared, staged } = input
  const [book, unmirrored, profile] = await Promise.all([
    deps.portfolio.viewAbsolute({ now: input.now, signal: input.signal }),
    deps.intents.unmirroredExposure(input.signal),
    findBuyProfile(deps, staged.side, input.signal),
  ])

  assertBookPriced(book, profile)

  return rejectionsFor(deps, {
    side: staged.side,
    orderType: staged.orderType,
    notional: prepared.notional,
    notionalBase: prepared.notionalBase,
    hasStopLoss: staged.stopLoss !== undefined,
    venue: prepared.venue,
    book,
    unmirrored,
  })
}

/** Written before the order leaves, so a process that dies while the exchange holds it leaves a
 *  row the sweep keeps, visible to the operator and charged against the caps. Not best effort:
 *  an order that cannot be recorded is not sent. Every later outcome overwrites it. */
async function markInFlight(deps: OrderServiceDeps, input: SubmitInput): Promise<void> {
  await deps.intents.recordOutcome({
    token: input.staged.token,
    failure: UNRECONCILED_FAILURE,
    signal: input.signal,
  })
}

/** `clientOrderId` dedupes only while the first order is still pending, and a market order stops
 *  being pending in well under a second — so a transport error on the POST more often means "filled,
 *  response lost" than "never arrived". Recovery is a lookup, never a resubmit. */
async function submit(deps: OrderServiceDeps, input: SubmitInput): Promise<OrderReceipt> {
  const orderId = await place(deps, input)

  // Before the poll: a process that dies in it leaves a row the reconcile pass can match.
  await markUnreconciled(deps, input, { orderId })

  try {
    return await pollUntilTerminal(deps, input, orderId)
  } catch (err: unknown) {
    // `order.unfilled` is the exchange's answer, read back after a cancel; every other escape is a
    // lost one.
    if (err instanceof OrderError && err.code === 'order.unfilled') {
      await settleUnfilled(deps, input, orderId)
    } else {
      await markUnreconciled(deps, input, { cause: err, orderId })

      if (input.signal.aborted) {
        await cancelAfterAbort(deps, input, orderId)
      }
    }

    throw err
  }
}

/** An abort during the poll leaves the order standing at the exchange. Best effort: the marker is
 *  already written, and a failed cancel is logged. */
async function cancelAfterAbort(
  deps: OrderServiceDeps,
  input: SubmitInput,
  orderId: string
): Promise<void> {
  try {
    await input.venue.adapter.cancelOrder({
      symbol: input.staged.symbol,
      orderId,
      signal: settleSignal(),
    })
  } catch (err: unknown) {
    deps.logger.warn('order.abort_cancel_failed', {
      clientOrderId: input.staged.clientOrderId,
      orderId,
      symbol: input.staged.symbol,
      err: formatErrForLog(err),
    })
  }
}

/** The venue settled it with nothing moved: the marker is dropped and the sweep takes the row,
 *  because an outcome the exchange gave is not one a human has to reconcile. A write that fails
 *  here leaves the row listed and must not replace the refusal the caller is about to raise. */
async function settleUnfilled(
  deps: OrderServiceDeps,
  input: SubmitInput,
  orderId?: string
): Promise<void> {
  try {
    await deps.intents.recordOutcome({
      token: input.staged.token,
      signal: settleSignal(),
      ...(orderId === undefined ? {} : { orderId }),
    })
  } catch (err: unknown) {
    deps.logger.error('order.outcome_unrecorded', {
      clientOrderId: input.staged.clientOrderId,
      symbol: input.staged.symbol,
      err: formatErrForLog(err),
      ...(orderId === undefined ? {} : { orderId }),
    })
  }
}

async function place(deps: OrderServiceDeps, input: SubmitInput): Promise<string> {
  const { staged } = input

  try {
    const orderId = await input.venue.adapter.placeOrder({
      symbol: staged.symbol,
      side: staged.side,
      orderType: staged.orderType,
      size: staged.quantity,
      clientOrderId: staged.clientOrderId,
      signal: input.signal,
      ...(staged.limitPrice === undefined ? {} : { limitPrice: staged.limitPrice }),
    })

    deps.logger.info('order.placed', {
      clientOrderId: staged.clientOrderId,
      orderId,
      symbol: staged.symbol,
    })

    return orderId
  } catch (err: unknown) {
    if (!(err instanceof OrderError)) {
      throw err
    }

    // `order.network` is the only code that does not say whether the exchange took the order;
    // every other is its answer.
    if (err.code !== 'order.network') {
      await settleUnfilled(deps, input)

      throw err
    }

    return await recover(deps, input, err)
  }
}

/** The POST failed in transport, which says nothing about whether the exchange took it. One lookup
 *  answers; one that finds nothing, or cannot be made, leaves the in-flight marker standing and the
 *  original error with it. */
async function recover(
  deps: OrderServiceDeps,
  input: SubmitInput,
  cause: OrderError
): Promise<string> {
  const { staged } = input
  const receipt = await lookupByClientOrderId(deps, input)

  if (receipt === undefined) {
    throw cause
  }

  deps.logger.warn('order.recovered', {
    clientOrderId: staged.clientOrderId,
    orderId: receipt.orderId,
    symbol: staged.symbol,
    err: formatErrForLog(cause),
  })

  return receipt.orderId
}

async function lookupByClientOrderId(
  deps: OrderServiceDeps,
  input: SubmitInput
): Promise<OrderReceipt | undefined> {
  const { staged } = input

  try {
    return await input.venue.adapter.fetchOrder({
      symbol: staged.symbol,
      clientOrderId: staged.clientOrderId,
      signal: settleSignal(),
    })
  } catch (err: unknown) {
    deps.logger.error('order.recovery_unreachable', {
      clientOrderId: staged.clientOrderId,
      symbol: staged.symbol,
      err: formatErrForLog(err),
    })

    return undefined
  }
}

interface Unreconciled {
  readonly cause?: unknown
  readonly orderId: string
}

/** Names the order on the marker the row already carries. The row is what a human reconciles
 *  against, so a write that fails here must not also erase the error that caused it. */
async function markUnreconciled(
  deps: OrderServiceDeps,
  input: SubmitInput,
  unreconciled: Unreconciled
): Promise<void> {
  try {
    await deps.intents.recordOutcome({
      token: input.staged.token,
      failure: UNRECONCILED_FAILURE,
      orderId: unreconciled.orderId,
      signal: settleSignal(),
    })
  } catch (err: unknown) {
    deps.logger.error('order.unreconciled_unrecorded', {
      clientOrderId: input.staged.clientOrderId,
      symbol: input.staged.symbol,
      err: formatErrForLog(err),
      ...(unreconciled.cause === undefined
        ? {}
        : { cause: formatErrForLog(unreconciled.cause).message }),
    })
  }
}

/** The entry is booked and the exit is not: the position exists and is unprotected, which the
 *  receipt has to lead with rather than report as a footnote. */
async function attachExit(
  deps: OrderServiceDeps,
  filled: FilledOrder,
  exit: ExitLevels
): Promise<Pick<ExecutedOrder, 'exit' | 'exitFailure'>> {
  const { input, receipt } = filled

  try {
    assertRestsExits(deps.venues, filled.venue.id)

    const placed = await placeExit(deps, {
      instrument: input.staged.instrument,
      symbol: input.staged.symbol,
      venue: filled.venue,
      exit,
      reference: receipt.averagePrice,
      quantity: filled.numbers.quantity,
      key: input.staged.token,
      now: input.now,
      signal: input.signal,
    })

    return { exit: placed.receipt }
  } catch (err: unknown) {
    deps.logger.error('order.exit_failed', {
      clientOrderId: input.staged.clientOrderId,
      orderId: receipt.orderId,
      symbol: input.staged.symbol,
      err: formatErrForLog(err),
    })

    return { exitFailure: err instanceof OrderError ? err.code : 'order.exit_failed' }
  }
}
