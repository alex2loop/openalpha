import { z } from 'zod'

import type {
  CancelExitInput,
  ExitLookup,
  ExitReceipt,
  ExitStatus,
  PlaceExitInput,
} from '@/trading/kernel/venue/spot-adapter'
import type { BinanceOrder } from '@/trading/venues/binance/receipt'
import type { BinanceTransportDeps } from '@/trading/venues/binance/transport'
import { OrderError } from '@/trading/features/order/types'
import {
  ACK_RESPONSE,
  ORDER,
  ORDER_ACK,
  ORDER_PATH,
  REJECTED_STATUS,
  readReceipt,
  toOrderState,
} from '@/trading/venues/binance/receipt'
import {
  BINANCE_CANCEL_SETTLED_CODES,
  BINANCE_CLIENT_ORDER_ID_LENGTH,
  ORDER_NOT_FOUND_CODES,
  signedRequest,
  UNREAD_BODY,
} from '@/trading/venues/binance/transport'
import { hashedClientOrderId } from '@/trading/venues/client-order-id'
import { toDecimalString } from '@/trading/venues/decimal'

const OCO_PATH = '/api/v3/orderList/oco'
const ORDER_LIST_PATH = '/api/v3/orderList'
// An exit rides a buy: spot has no short side, so a sale is the only way out.
export const EXIT_SIDE = 'SELL'
export const STOP_LOSS_TYPE = 'STOP_LOSS'
export const TAKE_PROFIT_TYPE = 'TAKE_PROFIT'
const TAKE_PROFIT_LEG_KEY = 'take-profit'
// Binance's `orderListId` on an order that belongs to no list.
export const NO_ORDER_LIST = -1
const OCO_ACK = z.object({
  orders: z.array(z.object({ orderId: z.number(), clientOrderId: z.string() })),
})
const ORDER_LIST = z.object({ orders: z.array(z.object({ orderId: z.number() })) })

interface Trigger {
  readonly type: string
  readonly price: number
}

interface BothLegs {
  readonly takeProfit: number
  readonly stopLoss: number
}

/** The stop leg, or the one trigger, carries `exitClientId`, so a lookup by it always lands on an
 *  order Binance can find. Its order id names the exit. */
export async function placeExit(
  deps: BinanceTransportDeps,
  input: PlaceExitInput
): Promise<ExitReceipt> {
  const { takeProfit, stopLoss } = input
  const exitId =
    takeProfit !== undefined && stopLoss !== undefined
      ? await placeOco(deps, input, { takeProfit, stopLoss })
      : await placeTrigger(deps, input, singleTrigger(input))

  return { exitId, exitClientId: input.exitClientId }
}

export async function fetchExit(
  deps: BinanceTransportDeps,
  lookup: ExitLookup
): Promise<ExitStatus | undefined> {
  const named = await signedRequest(deps, {
    method: 'GET',
    path: ORDER_PATH,
    params: { symbol: lookup.symbol, origClientOrderId: lookup.exitClientId },
    schema: ORDER,
    signal: lookup.signal,
    acceptedCodes: ORDER_NOT_FOUND_CODES,
  })

  if (named === undefined) {
    return undefined
  }

  const legs =
    named.orderListId === NO_ORDER_LIST ? [named] : await listLegs(deps, named, lookup.signal)

  const status = await toExitStatus(deps, legs, lookup.signal)

  return status.state === 'live' ? { ...status, exitId: String(named.orderId) } : status
}

/** One cancel on the order the exit is named by: Binance takes the whole OCO down with any leg. */
export async function cancelExit(
  deps: BinanceTransportDeps,
  input: CancelExitInput
): Promise<void> {
  await signedRequest(deps, {
    method: 'DELETE',
    path: ORDER_PATH,
    params: { symbol: input.symbol, orderId: input.exitId },
    schema: UNREAD_BODY,
    signal: input.signal,
    acceptedCodes: BINANCE_CANCEL_SETTLED_CODES,
  })
}

function singleTrigger(input: PlaceExitInput): Trigger {
  if (input.stopLoss !== undefined) {
    return { type: STOP_LOSS_TYPE, price: input.stopLoss }
  }

  if (input.takeProfit !== undefined) {
    return { type: TAKE_PROFIT_TYPE, price: input.takeProfit }
  }

  throw new OrderError('order.exit_failed', 'an exit needs a take-profit or a stop-loss')
}

async function placeOco(
  deps: BinanceTransportDeps,
  input: PlaceExitInput,
  legs: BothLegs
): Promise<string> {
  const ack = await signedRequest(deps, {
    method: 'POST',
    path: OCO_PATH,
    params: {
      symbol: input.symbol,
      side: EXIT_SIDE,
      quantity: toDecimalString(input.size),
      aboveType: TAKE_PROFIT_TYPE,
      aboveStopPrice: toDecimalString(legs.takeProfit),
      aboveClientOrderId: hashedClientOrderId(
        `${input.exitClientId}:${TAKE_PROFIT_LEG_KEY}`,
        BINANCE_CLIENT_ORDER_ID_LENGTH
      ),
      belowType: STOP_LOSS_TYPE,
      belowStopPrice: toDecimalString(legs.stopLoss),
      belowClientOrderId: input.exitClientId,
    },
    schema: OCO_ACK,
    signal: input.signal,
  })
  const stop = ack?.orders.find((leg) => leg.clientOrderId === input.exitClientId)

  if (stop === undefined) {
    throw new OrderError('order.exit_failed', 'the exchange returned no exit id')
  }

  return String(stop.orderId)
}

async function placeTrigger(
  deps: BinanceTransportDeps,
  input: PlaceExitInput,
  trigger: Trigger
): Promise<string> {
  const ack = await signedRequest(deps, {
    method: 'POST',
    path: ORDER_PATH,
    params: {
      symbol: input.symbol,
      side: EXIT_SIDE,
      type: trigger.type,
      quantity: toDecimalString(input.size),
      stopPrice: toDecimalString(trigger.price),
      newClientOrderId: input.exitClientId,
      newOrderRespType: ACK_RESPONSE,
    },
    schema: ORDER_ACK,
    signal: input.signal,
  })

  if (ack === undefined) {
    throw new OrderError('order.exit_failed', 'the exchange returned no exit id')
  }

  return String(ack.orderId)
}

async function listLegs(
  deps: BinanceTransportDeps,
  named: BinanceOrder,
  signal: AbortSignal
): Promise<readonly BinanceOrder[]> {
  const list = await signedRequest(deps, {
    method: 'GET',
    path: ORDER_LIST_PATH,
    params: { orderListId: String(named.orderListId) },
    schema: ORDER_LIST,
    signal,
  })
  const legs: BinanceOrder[] = [named]

  for (const leg of list?.orders ?? []) {
    if (leg.orderId !== named.orderId) {
      const order = await signedRequest(deps, {
        method: 'GET',
        path: ORDER_PATH,
        params: { symbol: named.symbol, orderId: String(leg.orderId) },
        schema: ORDER,
        signal,
      })

      legs.push(...(order === undefined ? [] : [order]))
    }
  }

  return legs
}

/** A leg that filled anything has fired, even one that then expired short of its size: what it
 *  filled is the fill. */
async function toExitStatus(
  deps: BinanceTransportDeps,
  legs: readonly BinanceOrder[],
  signal: AbortSignal
): Promise<ExitStatus> {
  const fired = legs.find((leg) => leg.executedQty > 0)

  if (fired !== undefined) {
    const fill = await readReceipt(deps, fired, signal)

    return fill === undefined ? { state: 'triggered' } : { state: 'triggered', fill }
  }

  if (legs.some((leg) => toOrderState(leg.status) === 'live')) {
    return { state: 'live' }
  }

  if (legs.some((leg) => leg.status === REJECTED_STATUS)) {
    return { state: 'failed' }
  }

  return { state: 'canceled' }
}
