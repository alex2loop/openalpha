import { z } from 'zod'

import type {
  FilledOrderLookup,
  FilledOrderWindow,
  OrderReceipt,
  VenueBalance,
} from '@/trading/kernel/venue/spot-adapter'
import type { BinanceOrder } from '@/trading/venues/binance/receipt'
import type { BinanceTransportDeps } from '@/trading/venues/binance/transport'
import { MS_PER_DAY, sleep } from '@/core/utils/time'
import { ORDER, readReceipt } from '@/trading/venues/binance/receipt'
import { toBinancePair } from '@/trading/venues/binance/symbol'
import {
  BINANCE_QUOTE_ASSET,
  signedRequest,
  UNKNOWN_SYMBOL_CODES,
} from '@/trading/venues/binance/transport'

const ALL_ORDERS_PATH = '/api/v3/allOrders'
const FILLED_STATUS = 'FILLED'
// The most orders one page returns. Sent explicitly: the endpoint's own default is half of it.
const PAGE_SIZE = 1000
// The widest span Binance lets one time-bounded page cover.
const PAGE_SPAN_MS = MS_PER_DAY
// Pages one symbol's walk back may take. A bound, not a policy: an unbounded walk against a paging
// bug would never return.
const MAXIMUM_HISTORY_PAGES = 50
// Spacing between one order's trade read and the next: a walk over a long book otherwise sends
// one signed request per filled order back to back and spends the venue's request weight in a burst.
const TRADE_READ_SPACING_MS = 120
const ORDERS = z.array(ORDER)

interface SymbolWindow {
  readonly symbol: string
  readonly since: number
  readonly signal: AbortSignal
}

export async function fetchFilledOrders(
  deps: BinanceTransportDeps,
  lookup: FilledOrderLookup
): Promise<readonly OrderReceipt[]> {
  const orders = await filledOrdersOf(deps, {
    symbol: lookup.symbol,
    since: lookup.since,
    signal: lookup.signal,
  })
  const onSide = orders.filter((order) => order.side.toLowerCase() === lookup.side)

  return await readReceipts(deps, onSide, lookup.signal)
}

/** The book's symbols at this venue plus every asset held there now, read one at a time. A round
 *  trip on a coin neither names is not found, which the manifest's `fills: 'by-symbol'` tells the
 *  operator. */
export async function listFilledOrders(
  deps: BinanceTransportDeps,
  window: FilledOrderWindow,
  held: readonly VenueBalance[]
): Promise<readonly OrderReceipt[]> {
  const receipts: OrderReceipt[] = []

  for (const symbol of symbolsToRead(window, held)) {
    const orders = await filledOrdersOf(deps, {
      symbol,
      since: window.since,
      signal: window.signal,
    })

    receipts.push(...(await readReceipts(deps, orders, window.signal)))
  }

  return receipts
}

function symbolsToRead(
  window: FilledOrderWindow,
  held: readonly VenueBalance[]
): readonly string[] {
  const heldPairs = held
    .filter((balance) => balance.quantity > 0 && balance.asset !== BINANCE_QUOTE_ASSET)
    .map((balance) => toBinancePair(balance.asset))

  return [...new Set([...window.symbols, ...heldPairs])]
}

/** The newest page first, which on a hand-run book is every order the symbol ever had. Only a full
 *  page walks back, a day at a time, to the start of the window. */
async function filledOrdersOf(
  deps: BinanceTransportDeps,
  request: SymbolWindow
): Promise<readonly BinanceOrder[]> {
  const newest = await readOrders(deps, request, {})
  const earliest = Math.min(...newest.map((order) => order.time))
  const older =
    newest.length === PAGE_SIZE && earliest > request.since
      ? await walkBack(deps, request, earliest)
      : []

  return [...older, ...newest].filter(
    (order) => order.status === FILLED_STATUS && order.updateTime >= request.since
  )
}

async function walkBack(
  deps: BinanceTransportDeps,
  request: SymbolWindow,
  before: number
): Promise<readonly BinanceOrder[]> {
  const orders: BinanceOrder[] = []
  let endTime = before - 1

  for (let page = 0; page < MAXIMUM_HISTORY_PAGES && endTime >= request.since; page += 1) {
    const startTime = Math.max(endTime - PAGE_SPAN_MS + 1, request.since)
    const range = { startTime: String(startTime), endTime: String(endTime) }

    orders.push(...(await readOrders(deps, request, range)))
    endTime = startTime - 1
  }

  if (endTime >= request.since) {
    deps.logger.warn('binance.order_history_truncated', {
      symbol: request.symbol,
      pages: MAXIMUM_HISTORY_PAGES,
      since: request.since,
    })
  }

  return orders
}

async function readOrders(
  deps: BinanceTransportDeps,
  request: SymbolWindow,
  range: Readonly<Record<string, string>>
): Promise<readonly BinanceOrder[]> {
  const orders = await signedRequest(deps, {
    method: 'GET',
    path: ALL_ORDERS_PATH,
    params: { symbol: request.symbol, limit: String(PAGE_SIZE), ...range },
    schema: ORDERS,
    signal: request.signal,
    acceptedCodes: UNKNOWN_SYMBOL_CODES,
  })

  return orders ?? []
}

async function readReceipts(
  deps: BinanceTransportDeps,
  orders: readonly BinanceOrder[],
  signal: AbortSignal
): Promise<readonly OrderReceipt[]> {
  const receipts: OrderReceipt[] = []

  for (const [index, order] of orders.entries()) {
    if (index > 0 && order.executedQty > 0) {
      await sleep(TRADE_READ_SPACING_MS, signal)
    }

    const receipt = await readReceipt(deps, order, signal)

    receipts.push(...(receipt === undefined ? [] : [receipt]))
  }

  return receipts
}
