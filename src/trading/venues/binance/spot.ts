import { z } from 'zod'

import type {
  CancelOrderInput,
  FilledOrderWindow,
  InstrumentLimits,
  OrderLookup,
  OrderReceipt,
  OrderSide,
  OrderType,
  PlaceOrderInput,
  SpotAdapter,
  VenueBalance,
} from '@/trading/kernel/venue/spot-adapter'
import type { BinanceTransportDeps } from '@/trading/venues/binance/transport'
import { OrderError } from '@/trading/features/order/types'
import { cancelExit, fetchExit, placeExit } from '@/trading/venues/binance/exit'
import {
  EXCHANGE_INFO,
  EXCHANGE_INFO_PATH,
  minimumSizeOf,
  toSymbolFilters,
} from '@/trading/venues/binance/filters'
import { fetchFilledOrders, listFilledOrders } from '@/trading/venues/binance/history'
import { listOpenExits } from '@/trading/venues/binance/open-exits'
import { fetchAssetPrice, fetchSymbolPrice } from '@/trading/venues/binance/price'
import {
  ACK_RESPONSE,
  ORDER,
  ORDER_ACK,
  ORDER_PATH,
  readReceipt,
} from '@/trading/venues/binance/receipt'
import { RECEIVE_WINDOW_MS } from '@/trading/venues/binance/sign'
import { toBinancePair, toBinanceTicker } from '@/trading/venues/binance/symbol'
import {
  BINANCE_CANCEL_SETTLED_CODES,
  BINANCE_CLIENT_ORDER_ID_LENGTH,
  BINANCE_QUOTE_ASSET,
  binancePublicRequest,
  DECIMAL,
  ORDER_NOT_FOUND_CODES,
  signedRequest,
  UNKNOWN_SYMBOL_CODES,
  UNREAD_BODY,
} from '@/trading/venues/binance/transport'
import { hashedClientOrderId } from '@/trading/venues/client-order-id'
import { toDecimalString } from '@/trading/venues/decimal'
import { assertClockWithin } from '@/trading/venues/transport'

const TIME_PATH = '/api/v3/time'
const ACCOUNT_PATH = '/api/v3/account'
const GOOD_TILL_CANCELLED = 'GTC'
// Binance refuses a stamp 1 s ahead of it or older than the receive window, so the two bounds
// differ; each keeps half its margin for the network.
const MAXIMUM_CLOCK_LEAD_MS = 500
const MAXIMUM_CLOCK_LAG_MS = RECEIVE_WINDOW_MS / 2
const SIDE_NAMES = Object.freeze({ buy: 'BUY', sell: 'SELL' } as const satisfies Record<
  OrderSide,
  string
>)
const TYPE_NAMES = Object.freeze({ market: 'MARKET', limit: 'LIMIT' } as const satisfies Record<
  OrderType,
  string
>)
const SERVER_TIME = z.object({ serverTime: z.number() })
const ACCOUNT = z.object({
  balances: z.array(z.object({ asset: z.string(), free: DECIMAL, locked: DECIMAL })),
})

export function createBinanceSpotAdapter(deps: BinanceTransportDeps): SpotAdapter {
  const { simulated } = deps.credentials

  return {
    quoteAsset: BINANCE_QUOTE_ASSET,
    toSymbol: (instrument) => toBinancePair(instrument.ticker),
    toTicker: toBinanceTicker,
    toClientOrderId: (key) => hashedClientOrderId(key, BINANCE_CLIENT_ORDER_ID_LENGTH),
    assertClockInSync: (signal) => assertClockInSync(deps, signal),
    fetchLimits: (symbol, signal) => fetchLimits(simulated, symbol, signal),
    placeOrder: (input) => placeOrder(deps, input),
    fetchOrder: (lookup) => fetchOrder(deps, lookup),
    fetchFilledOrders: (lookup) => fetchFilledOrders(deps, lookup),
    listFilledOrders: (window) => listHeldAndBookedFills(deps, window),
    fetchAssetPrice: (asset, signal) => fetchAssetPrice(simulated, asset, signal),
    fetchBalances: (signal) => fetchBalances(deps, signal),
    cancelOrder: (input) => cancelOrder(deps, input),
    placeExit: (input) => placeExit(deps, input),
    fetchExit: (lookup) => fetchExit(deps, lookup),
    cancelExit: (input) => cancelExit(deps, input),
    listOpenExits: (signal) => listOpenExits(deps, signal),
  }
}

async function assertClockInSync(deps: BinanceTransportDeps, signal: AbortSignal): Promise<void> {
  const sentAt = deps.now()
  const time = await binancePublicRequest(deps.credentials.simulated, {
    path: TIME_PATH,
    schema: SERVER_TIME,
    signal,
  })
  const receivedAt = deps.now()

  if (time === undefined) {
    throw new OrderError('order.network', 'exchange time is unreadable')
  }

  assertClockWithin({
    sentAt,
    receivedAt,
    serverMs: time.serverTime,
    maximumLeadMs: MAXIMUM_CLOCK_LEAD_MS,
    maximumLagMs: MAXIMUM_CLOCK_LAG_MS,
  })
}

async function fetchLimits(
  simulated: boolean,
  symbol: string,
  signal: AbortSignal
): Promise<InstrumentLimits> {
  const [info, price] = await Promise.all([
    binancePublicRequest(simulated, {
      path: EXCHANGE_INFO_PATH,
      params: { symbol },
      schema: EXCHANGE_INFO,
      signal,
      acceptedCodes: UNKNOWN_SYMBOL_CODES,
    }),
    fetchSymbolPrice(simulated, symbol, signal),
  ])
  const row = info?.symbols[0]
  const filters = row === undefined ? undefined : toSymbolFilters(row)

  if (filters === undefined) {
    throw new OrderError('order.rejected', `no spot instrument ${symbol}`)
  }

  return {
    symbol,
    lotSize: filters.lotSize,
    minimumSize: minimumSizeOf(filters, price),
    tickSize: filters.tickSize,
    // The resting stop triggers as a market order, so a floor that skips market orders never binds it.
    ...(filters.minimumNotional > 0 && filters.minimumNotionalAppliesToMarket
      ? { minimumNotional: filters.minimumNotional }
      : {}),
  }
}

async function placeOrder(deps: BinanceTransportDeps, input: PlaceOrderInput): Promise<string> {
  const ack = await signedRequest(deps, {
    method: 'POST',
    path: ORDER_PATH,
    params: {
      symbol: input.symbol,
      side: SIDE_NAMES[input.side],
      type: TYPE_NAMES[input.orderType],
      quantity: toDecimalString(input.size),
      newClientOrderId: input.clientOrderId,
      newOrderRespType: ACK_RESPONSE,
      ...(input.limitPrice === undefined
        ? {}
        : { price: toDecimalString(input.limitPrice), timeInForce: GOOD_TILL_CANCELLED }),
    },
    schema: ORDER_ACK,
    signal: input.signal,
  })

  if (ack === undefined) {
    throw new OrderError('order.rejected', 'the exchange returned no order id')
  }

  return String(ack.orderId)
}

async function fetchOrder(
  deps: BinanceTransportDeps,
  lookup: OrderLookup
): Promise<OrderReceipt | undefined> {
  const order = await signedRequest(deps, {
    method: 'GET',
    path: ORDER_PATH,
    params: {
      symbol: lookup.symbol,
      ...(lookup.orderId === undefined ? {} : { orderId: lookup.orderId }),
      ...(lookup.clientOrderId === undefined ? {} : { origClientOrderId: lookup.clientOrderId }),
    },
    schema: ORDER,
    signal: lookup.signal,
    acceptedCodes: ORDER_NOT_FOUND_CODES,
  })

  return order === undefined ? undefined : await readReceipt(deps, order, lookup.signal)
}

/** Held means free plus locked: a resting exit locks its coins, and they are still the operator's. */
async function fetchBalances(
  deps: BinanceTransportDeps,
  signal: AbortSignal
): Promise<readonly VenueBalance[]> {
  const account = await signedRequest(deps, {
    method: 'GET',
    path: ACCOUNT_PATH,
    params: { omitZeroBalances: 'true' },
    schema: ACCOUNT,
    signal,
  })

  return (account?.balances ?? []).map((row) => ({
    asset: row.asset,
    quantity: row.free + row.locked,
  }))
}

/** Binance lists history one symbol at a time, so the book's symbols are widened by what the
 *  account holds now: a coin bought by hand and still held is found though the book never named it. */
async function listHeldAndBookedFills(
  deps: BinanceTransportDeps,
  window: FilledOrderWindow
): Promise<readonly OrderReceipt[]> {
  const held = await fetchBalances(deps, window.signal)

  return await listFilledOrders(deps, window, held)
}

async function cancelOrder(deps: BinanceTransportDeps, input: CancelOrderInput): Promise<void> {
  await signedRequest(deps, {
    method: 'DELETE',
    path: ORDER_PATH,
    params: { symbol: input.symbol, orderId: input.orderId },
    schema: UNREAD_BODY,
    signal: input.signal,
    acceptedCodes: BINANCE_CANCEL_SETTLED_CODES,
  })
}
