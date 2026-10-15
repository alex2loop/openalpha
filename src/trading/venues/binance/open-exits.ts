import { z } from 'zod'

import type { OpenExit } from '@/trading/kernel/venue/spot-adapter'
import type { BinanceTransportDeps } from '@/trading/venues/binance/transport'
import {
  EXIT_SIDE,
  NO_ORDER_LIST,
  STOP_LOSS_TYPE,
  TAKE_PROFIT_TYPE,
} from '@/trading/venues/binance/exit'
import {
  BINANCE_CLIENT_ORDER_ID_LENGTH,
  DECIMAL,
  signedRequest,
} from '@/trading/venues/binance/transport'
import { isHashedClientOrderId } from '@/trading/venues/client-order-id'

const OPEN_ORDERS_PATH = '/api/v3/openOrders'
const OPEN_ORDERS = z.array(
  z.object({
    orderId: z.number(),
    orderListId: z.number(),
    symbol: z.string(),
    clientOrderId: z.string(),
    side: z.string(),
    type: z.string(),
    origQty: DECIMAL,
    stopPrice: DECIMAL,
  })
)

type OpenOrder = z.infer<typeof OPEN_ORDERS>[number]

/** Every open order of the account, in one call: with no symbol the endpoint answers for all of
 *  them, and a stop leg is only an order here. An OCO is two legs sharing an `orderListId` and it
 *  is one exit, named by its stop leg, which is where `placeExit` puts the client id. */
export async function listOpenExits(
  deps: BinanceTransportDeps,
  signal: AbortSignal
): Promise<readonly OpenExit[]> {
  const orders = await signedRequest(deps, {
    method: 'GET',
    path: OPEN_ORDERS_PATH,
    schema: OPEN_ORDERS,
    signal,
  })
  const triggers = (orders ?? []).filter(
    (order) =>
      order.side === EXIT_SIDE && (order.type === STOP_LOSS_TYPE || order.type === TAKE_PROFIT_TYPE)
  )

  return [...groupByExit(triggers).values()].flatMap((legs) => {
    const exit = toOpenExit(legs)

    return exit === undefined ? [] : [exit]
  })
}

function groupByExit(orders: readonly OpenOrder[]): ReadonlyMap<string, readonly OpenOrder[]> {
  const groups = new Map<string, OpenOrder[]>()

  for (const order of orders) {
    const key =
      order.orderListId === NO_ORDER_LIST ? `order:${order.orderId}` : `list:${order.orderListId}`

    groups.set(key, [...(groups.get(key) ?? []), order])
  }

  return groups
}

function toOpenExit(legs: readonly OpenOrder[]): OpenExit | undefined {
  const stop = legs.find((leg) => leg.type === STOP_LOSS_TYPE)
  const take = legs.find((leg) => leg.type === TAKE_PROFIT_TYPE)
  const named = stop ?? take

  if (
    named === undefined ||
    !isHashedClientOrderId(named.clientOrderId, BINANCE_CLIENT_ORDER_ID_LENGTH)
  ) {
    return undefined
  }

  return {
    symbol: named.symbol,
    exitId: String(named.orderId),
    exitClientId: named.clientOrderId,
    size: named.origQty,
    ...(take === undefined ? {} : { takeProfit: take.stopPrice }),
    ...(stop === undefined ? {} : { stopLoss: stop.stopPrice }),
  }
}
