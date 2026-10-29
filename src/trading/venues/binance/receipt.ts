import { z } from 'zod'

import type { FeePriceLookup } from '@/trading/kernel/venue/fee'
import type { OrderReceipt, OrderState } from '@/trading/kernel/venue/spot-adapter'
import type { BinanceTransportDeps } from '@/trading/venues/binance/transport'
import { OrderError } from '@/trading/features/order/types'
import { ORDER_SIDES } from '@/trading/kernel/venue/spot-adapter'
import { fetchAssetPrice } from '@/trading/venues/binance/price'
import { toBinanceTicker } from '@/trading/venues/binance/symbol'
import { BINANCE_QUOTE_ASSET, DECIMAL, signedRequest } from '@/trading/venues/binance/transport'

const TRADES_PATH = '/api/v3/myTrades'
const TRADES = z.array(
  z.object({ commission: DECIMAL, commissionAsset: z.string(), time: z.number() })
)

export const ORDER_PATH = '/api/v3/order'
export const ACK_RESPONSE = 'ACK'
export const REJECTED_STATUS = 'REJECTED'
export const ORDER = z.object({
  orderId: z.number(),
  orderListId: z.number(),
  symbol: z.string(),
  side: z.string(),
  status: z.string(),
  executedQty: DECIMAL,
  cummulativeQuoteQty: DECIMAL,
  time: z.number(),
  updateTime: z.number(),
})
export const ORDER_ACK = z.object({ orderId: z.number() })

type BinanceTrade = z.infer<typeof TRADES>[number]

export type BinanceOrder = z.infer<typeof ORDER>

interface ChargedFee {
  readonly amount: number
  readonly currency: string
  /** Base-asset fee already taken out of the quantity. */
  readonly inKind: number
}

interface ReceiptInput {
  readonly order: BinanceOrder
  readonly trades: readonly BinanceTrade[]
  readonly priceOf: FeePriceLookup
  readonly signal: AbortSignal
}

/** An order row carries no fee and no fill time, so a filled one is read with its trades. */
export async function readReceipt(
  deps: BinanceTransportDeps,
  order: BinanceOrder,
  signal: AbortSignal
): Promise<OrderReceipt | undefined> {
  const trades = order.executedQty > 0 ? await fetchTrades(deps, order, signal) : []

  return await toReceipt({
    order,
    trades: trades ?? [],
    priceOf: (asset, priceSignal) =>
      fetchAssetPrice(deps.credentials.simulated, asset, priceSignal),
    signal,
  })
}

/** NEW, PENDING_NEW and PENDING_CANCEL keep the poll going; anything final with nothing filled is
 *  a cancel as far as the order path is concerned. */
export function toOrderState(status: string): OrderState {
  switch (status) {
    case 'PARTIALLY_FILLED':
      return 'partially_filled'
    case 'FILLED':
      return 'filled'
    case 'CANCELED':
    case 'EXPIRED':
    case 'EXPIRED_IN_MATCH':
    case REJECTED_STATUS:
      return 'canceled'
    default:
      return 'live'
  }
}

function fetchTrades(
  deps: BinanceTransportDeps,
  order: BinanceOrder,
  signal: AbortSignal
): Promise<readonly BinanceTrade[] | undefined> {
  return signedRequest(deps, {
    method: 'GET',
    path: TRADES_PATH,
    params: { symbol: order.symbol, orderId: String(order.orderId) },
    schema: TRADES,
    signal,
  })
}

async function toReceipt(input: ReceiptInput): Promise<OrderReceipt | undefined> {
  const { order } = input
  const side = ORDER_SIDES.find((named) => named === order.side.toLowerCase())

  if (side === undefined) {
    return undefined
  }

  const averagePrice =
    order.executedQty > 0 && order.cummulativeQuoteQty > 0
      ? order.cummulativeQuoteQty / order.executedQty
      : 0
  // Coins moved with no trade row to price them: the fee is not known yet, and zero would book a
  // free fill and leave an in-kind fee in the quantity.
  const fee =
    order.executedQty > 0 && input.trades.length === 0
      ? undefined
      : await chargedFee(input, averagePrice)
  const filledAt = latestTradeTime(input.trades)

  return {
    orderId: String(order.orderId),
    symbol: order.symbol,
    side,
    state: toOrderState(order.status),
    averagePrice,
    filledQuantity: order.executedQty - (fee?.inKind ?? 0),
    // A receipt carries a charge as negative; Binance reports it positive.
    fee: fee === undefined ? 0 : -fee.amount,
    feeCurrency: fee?.currency ?? '',
    ...(fee === undefined ? { feeUnreported: true as const } : {}),
    ...(filledAt === undefined ? {} : { filledAt }),
  }
}

async function chargedFee(input: ReceiptInput, averagePrice: number): Promise<ChargedFee> {
  const byAsset = commissionsByAsset(input.trades)
  const [only, ...rest] = [...byAsset]

  if (only === undefined) {
    return { amount: 0, currency: BINANCE_QUOTE_ASSET, inKind: 0 }
  }

  if (rest.length === 0) {
    return { amount: only[1], currency: only[0], inKind: 0 }
  }

  return await foldIntoQuote(input, byAsset, averagePrice)
}

/** One order billed in several assets - the BNB balance ran out partway - becomes one quote fee.
 *  The base part leaves the quantity first, exactly as `toBookedFill` nets an in-kind fee. */
async function foldIntoQuote(
  input: ReceiptInput,
  byAsset: ReadonlyMap<string, number>,
  averagePrice: number
): Promise<ChargedFee> {
  const base = toBinanceTicker(input.order.symbol)
  let amount = 0
  let inKind = 0

  for (const [asset, charged] of byAsset) {
    if (asset === BINANCE_QUOTE_ASSET) {
      amount += charged
    } else if (asset === base) {
      inKind += charged
      amount += charged * averagePrice
    } else {
      amount += charged * (await pricedFeeAsset(input, asset))
    }
  }

  return { amount, currency: BINANCE_QUOTE_ASSET, inKind }
}

async function pricedFeeAsset(input: ReceiptInput, asset: string): Promise<number> {
  const price = await input.priceOf(asset, input.signal)

  if (price === undefined) {
    throw new OrderError('order.rejected', `binance fee in ${asset} has no quote price`)
  }

  return price
}

function commissionsByAsset(trades: readonly BinanceTrade[]): ReadonlyMap<string, number> {
  const byAsset = new Map<string, number>()

  for (const trade of trades) {
    if (trade.commission > 0) {
      const sum = (byAsset.get(trade.commissionAsset) ?? 0) + trade.commission

      byAsset.set(trade.commissionAsset, sum)
    }
  }

  return byAsset
}

function latestTradeTime(trades: readonly BinanceTrade[]): number | undefined {
  return trades.length === 0 ? undefined : Math.max(...trades.map((trade) => trade.time))
}
