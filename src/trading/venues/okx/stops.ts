import type { OkxRow, OkxTransportDeps } from '@/trading/venues/okx/transport'
import { privateRequest, SPOT_INST_TYPE } from '@/trading/venues/okx/transport'

export const ALGO_PENDING_PATH = '/api/v5/trade/orders-algo-pending'
const TRAILING_STOP_KIND = 'move_order_stop'
// The two kinds the app's TP/SL and OCO screens place, in the one combination the endpoint accepts
// in a single call; a trailing stop is its own kind and needs a call of its own. A plain trigger
// order is left out: without the price beside it, a sell trigger cannot be told from a take-profit.
export const TP_SL_ORDER_KINDS = 'conditional,oco'
const STOP_ORDER_KINDS = Object.freeze([TP_SL_ORDER_KINDS, TRAILING_STOP_KIND] as const)
export const SELL_SIDE = 'sell'

/** Live sell orders that carry a stop leg. A trailing stop is a stop by kind; a TP/SL or OCO order
 *  is one only where it names a stop trigger. */
export async function listStopSymbols(
  deps: OkxTransportDeps,
  signal: AbortSignal
): Promise<ReadonlySet<string>> {
  const pages = await Promise.all(
    STOP_ORDER_KINDS.map((ordType) =>
      privateRequest(deps, {
        method: 'GET',
        path: ALGO_PENDING_PATH,
        query: { instType: SPOT_INST_TYPE, ordType },
        signal,
      })
    )
  )

  return new Set(
    pages
      .flat()
      .filter((row) => row.side === SELL_SIDE && isStop(row))
      .flatMap((row) => (row.instId ? [row.instId] : []))
  )
}

function isStop(row: OkxRow): boolean {
  return row.ordType === TRAILING_STOP_KIND || (row.slTriggerPx ?? '') !== ''
}
