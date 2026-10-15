import type {
  AmendExitInput,
  CancelExitInput,
  CancelOrderInput,
  ExitLookup,
  ExitReceipt,
  ExitStatus,
  InstrumentLimits,
  OrderLookup,
  OrderReceipt,
  PlaceExitInput,
  PlaceOrderInput,
  SpotAdapter,
  VenueBalance,
} from '@/trading/kernel/venue/spot-adapter'
import type { OkxTransportDeps } from '@/trading/venues/okx/transport'
import { OrderError } from '@/trading/features/order/types'
import { hashedClientOrderId } from '@/trading/venues/client-order-id'
import { toDecimalString } from '@/trading/venues/decimal'
import { fetchFilledOrders, listFilledOrders } from '@/trading/venues/okx/history'
import { listOpenExits } from '@/trading/venues/okx/open-exits'
import { optionalNumber, toReceipt } from '@/trading/venues/okx/receipt'
import { listStopSymbols } from '@/trading/venues/okx/stops'
import { toPair, toTicker } from '@/trading/venues/okx/symbol'
import {
  CANCEL_SETTLED_CODES,
  CLIENT_ORDER_ID_LENGTH,
  INSTRUMENTS_PATH,
  NOT_FOUND_CODES,
  OKX_QUOTE_ASSET,
  privateRequest,
  publicRequest,
  SPOT_INST_TYPE,
} from '@/trading/venues/okx/transport'
import { assertClockWithin } from '@/trading/venues/transport'

const ORDER_PATH = '/api/v5/trade/order'
const CANCEL_ORDER_PATH = '/api/v5/trade/cancel-order'
const TICKER_PATH = '/api/v5/market/ticker'
const BALANCE_PATH = '/api/v5/account/balance'
const ALGO_PATH = '/api/v5/trade/order-algo'
const CANCEL_ALGO_PATH = '/api/v5/trade/cancel-algos'
const AMEND_ALGO_PATH = '/api/v5/trade/amend-algos'
const SERVER_TIME_PATH = '/api/v5/public/time'
const CASH_MODE = 'cash'
// OKX reads a spot market buy's `sz` as quote currency unless told otherwise, which would turn
// `0.01 BTC` into `0.01 USDT`. Pinned on every order, never defaulted.
const BASE_QUANTITY = 'base_ccy'
// "Fill at market when triggered". A stop carrying a limit price is a stop that does not execute in
// the move it exists for.
const TRIGGER_AT_MARKET = '-1'
// OKX refuses a stamp more than 30 s from its clock in either direction; each side keeps half for
// the network.
const MAXIMUM_CLOCK_SKEW_MS = 15_000

/** The one endpoint whose page nests a second list rather than being one flat row. */
interface OkxAccountRow {
  readonly details?: readonly Record<string, string | undefined>[]
}

/** What a trigger order reports about itself. `effective` means it fired and placed a regular
 *  order, which is where the fill is read from. OKX's own model, private to this file: what a
 *  caller sees is the neutral `ExitStatus`. */
interface AlgoStatus {
  readonly state: 'live' | 'effective' | 'canceled' | 'failed'
  readonly algoId?: string
  /** The regular order the trigger spawned; present once `effective`. */
  readonly ordId?: string
}

export function createOkxSpotAdapter(deps: OkxTransportDeps): SpotAdapter {
  return {
    quoteAsset: OKX_QUOTE_ASSET,
    toSymbol: (instrument) => toPair(instrument.ticker),
    toTicker,
    toClientOrderId: (key) => hashedClientOrderId(key, CLIENT_ORDER_ID_LENGTH),
    assertClockInSync: (signal) => assertClockInSync(deps, signal),
    fetchLimits: (symbol, signal) => fetchLimits(symbol, signal),
    placeOrder: (input) => placeOrder(deps, input),
    fetchOrder: (lookup) => fetchOrder(deps, lookup),
    fetchFilledOrders: (lookup) => fetchFilledOrders(deps, lookup),
    listFilledOrders: (window) => listFilledOrders(deps, window),
    fetchAssetPrice: (asset, signal) => fetchAssetPrice(asset, signal),
    fetchBalances: (signal) => fetchBalances(deps, signal),
    cancelOrder: (input) => cancelOrder(deps, input),
    placeExit: (input) => placeAlgo(deps, input),
    fetchExit: (lookup) => fetchExit(deps, lookup),
    cancelExit: (input) => cancelAlgo(deps, input),
    amendExit: (input) => amendAlgo(deps, input),
    listOpenExits: (signal) => listOpenExits(deps, signal),
    listStopSymbols: (signal) => listStopSymbols(deps, signal),
  }
}

async function assertClockInSync(deps: OkxTransportDeps, signal: AbortSignal): Promise<void> {
  const sentAt = deps.now()
  const rows = await publicRequest(SERVER_TIME_PATH, {}, signal)
  const receivedAt = deps.now()
  const serverMs = Number(rows[0]?.ts ?? Number.NaN)

  if (!Number.isFinite(serverMs)) {
    throw new OrderError('order.network', 'exchange time is unreadable')
  }

  assertClockWithin({
    sentAt,
    receivedAt,
    serverMs,
    maximumLeadMs: MAXIMUM_CLOCK_SKEW_MS,
    maximumLagMs: MAXIMUM_CLOCK_SKEW_MS,
  })
}

async function fetchLimits(instId: string, signal: AbortSignal): Promise<InstrumentLimits> {
  const rows = await publicRequest(INSTRUMENTS_PATH, { instType: SPOT_INST_TYPE, instId }, signal)
  const row = rows[0]

  if (row === undefined) {
    throw new OrderError('order.rejected', `no spot instrument ${instId}`)
  }

  return {
    symbol: instId,
    lotSize: numberOf(row.lotSz, `${instId} lotSz`),
    minimumSize: numberOf(row.minSz, `${instId} minSz`),
    tickSize: numberOf(row.tickSz, `${instId} tickSz`),
  }
}

async function placeOrder(deps: OkxTransportDeps, input: PlaceOrderInput): Promise<string> {
  const rows = await privateRequest(deps, {
    method: 'POST',
    path: ORDER_PATH,
    body: {
      instId: input.symbol,
      tdMode: CASH_MODE,
      side: input.side,
      ordType: input.orderType,
      tgtCcy: BASE_QUANTITY,
      sz: toDecimalString(input.size),
      clOrdId: input.clientOrderId,
      ...(input.limitPrice === undefined ? {} : { px: toDecimalString(input.limitPrice) }),
    },
    signal: input.signal,
  })
  const ordId = rows[0]?.ordId

  if (ordId === undefined || ordId === '') {
    throw new OrderError('order.rejected', 'the exchange returned no order id')
  }

  return ordId
}

async function fetchOrder(
  deps: OkxTransportDeps,
  lookup: OrderLookup
): Promise<OrderReceipt | undefined> {
  const rows = await privateRequest(deps, {
    method: 'GET',
    path: ORDER_PATH,
    query: {
      instId: lookup.symbol,
      ...(lookup.orderId === undefined ? {} : { ordId: lookup.orderId }),
      ...(lookup.clientOrderId === undefined ? {} : { clOrdId: lookup.clientOrderId }),
    },
    signal: lookup.signal,
    acceptedCodes: NOT_FOUND_CODES,
  })
  const row = rows[0]

  if (row === undefined) {
    return undefined
  }

  return toReceipt(row, lookup.symbol)
}

/** What the venue prices one asset at, in the currency it settles pairs in. Undefined when it lists
 *  no such pair — a fee asset it will not quote is one this tree cannot price — while a network
 *  failure still throws, because "not listed" and "could not ask" are different answers. */
async function fetchAssetPrice(asset: string, signal: AbortSignal): Promise<number | undefined> {
  try {
    const rows = await publicRequest(TICKER_PATH, { instId: toPair(asset) }, signal)
    const last = optionalNumber(rows[0]?.last, 0)

    return last > 0 ? last : undefined
  } catch (err: unknown) {
    if (err instanceof OrderError && err.code === 'order.rejected') {
      return undefined
    }

    throw err
  }
}

/** OKX omits a currency whose balance and equity are both zero, so an asset missing from this list
 *  is held at zero rather than unknown. A reader that treats absence as unknown reports every
 *  position it has closed as one the exchange lost. */
async function fetchBalances(
  deps: OkxTransportDeps,
  signal: AbortSignal
): Promise<readonly VenueBalance[]> {
  const rows = await privateRequest<OkxAccountRow>(deps, {
    method: 'GET',
    path: BALANCE_PATH,
    signal,
  })
  const balances: VenueBalance[] = []

  for (const detail of rows[0]?.details ?? []) {
    const asset = detail.ccy

    if (asset !== undefined && asset !== '') {
      balances.push({ asset, quantity: optionalNumber(detail.cashBal, 0) })
    }
  }

  return balances
}

async function cancelOrder(deps: OkxTransportDeps, input: CancelOrderInput): Promise<void> {
  await privateRequest(deps, {
    method: 'POST',
    path: CANCEL_ORDER_PATH,
    body: { instId: input.symbol, ordId: input.orderId },
    signal: input.signal,
    acceptedCodes: CANCEL_SETTLED_CODES,
  })
}

async function placeAlgo(deps: OkxTransportDeps, input: PlaceExitInput): Promise<ExitReceipt> {
  const bothLegs = input.takeProfit !== undefined && input.stopLoss !== undefined
  const rows = await privateRequest(deps, {
    method: 'POST',
    path: ALGO_PATH,
    body: {
      instId: input.symbol,
      tdMode: CASH_MODE,
      // An exit rides a buy: spot has no short side, so a sell is the way out already and there is
      // nothing behind it to protect.
      side: 'sell',
      ordType: bothLegs ? 'oco' : 'conditional',
      sz: toDecimalString(input.size),
      algoClOrdId: input.exitClientId,
      ...(input.takeProfit === undefined
        ? {}
        : { tpTriggerPx: toDecimalString(input.takeProfit), tpOrdPx: TRIGGER_AT_MARKET }),
      ...(input.stopLoss === undefined
        ? {}
        : { slTriggerPx: toDecimalString(input.stopLoss), slOrdPx: TRIGGER_AT_MARKET }),
    },
    signal: input.signal,
  })
  const algoId = rows[0]?.algoId

  if (algoId === undefined || algoId === '') {
    throw new OrderError('order.exit_failed', 'the exchange returned no exit id')
  }

  return { exitId: algoId, exitClientId: input.exitClientId }
}

/** Two calls behind one: the trigger's status, then the order it spawned. That shape is OKX's own
 *  - another venue reports the filled leg inline - so the caller never learns which. */
async function fetchExit(
  deps: OkxTransportDeps,
  lookup: ExitLookup
): Promise<ExitStatus | undefined> {
  const algo = await fetchAlgo(deps, lookup.exitClientId, lookup.signal)

  if (algo === undefined) {
    return undefined
  }

  if (algo.state === 'canceled' || algo.state === 'failed') {
    return { state: algo.state }
  }

  if (algo.state === 'live') {
    return { state: 'live', ...(algo.algoId === undefined ? {} : { exitId: algo.algoId }) }
  }

  if (algo.ordId === undefined) {
    return { state: 'triggered' }
  }

  const fill = await fetchOrder(deps, {
    symbol: lookup.symbol,
    orderId: algo.ordId,
    signal: lookup.signal,
  })

  return fill === undefined ? { state: 'triggered' } : { state: 'triggered', fill }
}

async function fetchAlgo(
  deps: OkxTransportDeps,
  algoClOrdId: string,
  signal: AbortSignal
): Promise<AlgoStatus | undefined> {
  const rows = await privateRequest(deps, {
    method: 'GET',
    path: ALGO_PATH,
    query: { algoClOrdId },
    signal,
    acceptedCodes: NOT_FOUND_CODES,
  })
  const row = rows[0]

  if (row === undefined) {
    return undefined
  }

  const ordId = row.ordId ?? ''
  const algoId = row.algoId ?? ''

  return {
    state: toAlgoState(row.state),
    ...(algoId === '' ? {} : { algoId }),
    ...(ordId === '' ? {} : { ordId }),
  }
}

/** OKX's algo states are not order states: a triggered exit is `effective`, never `filled`. */
function toAlgoState(raw: string | undefined): AlgoStatus['state'] {
  switch (raw) {
    case 'effective':
    case 'partially_effective':
      return 'effective'
    case 'canceled':
      return 'canceled'
    case 'order_failed':
    case 'partially_failed':
      return 'failed'
    default:
      return 'live'
  }
}

async function cancelAlgo(deps: OkxTransportDeps, input: CancelExitInput): Promise<void> {
  await privateRequest(deps, {
    method: 'POST',
    path: CANCEL_ALGO_PATH,
    body: [{ instId: input.symbol, algoId: input.exitId }],
    signal: input.signal,
  })
}

/** `cxlOnFail` is left at its default of false on purpose: a refused amendment must leave the
 *  resting exit exactly as it was rather than take it down. */
async function amendAlgo(deps: OkxTransportDeps, input: AmendExitInput): Promise<void> {
  await privateRequest(deps, {
    method: 'POST',
    path: AMEND_ALGO_PATH,
    body: [
      {
        instId: input.symbol,
        algoId: input.exitId,
        newSz: toDecimalString(input.size),
        ...(input.takeProfit === undefined
          ? {}
          : { newTpTriggerPx: toDecimalString(input.takeProfit), newTpOrdPx: TRIGGER_AT_MARKET }),
        ...(input.stopLoss === undefined
          ? {}
          : { newSlTriggerPx: toDecimalString(input.stopLoss), newSlOrdPx: TRIGGER_AT_MARKET }),
      },
    ],
    signal: input.signal,
  })
}

function numberOf(raw: string | undefined, label: string): number {
  const value = Number(raw)

  if (!Number.isFinite(value) || value <= 0) {
    throw new OrderError('order.rejected', `no usable ${label}`)
  }

  return value
}
