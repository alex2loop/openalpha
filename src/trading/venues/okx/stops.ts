import type { OkxRow, OkxTransportDeps } from '@/trading/venues/okx/transport'
import { optionalNumber } from '@/trading/venues/okx/receipt'
import { privateRequest, SPOT_INST_TYPE } from '@/trading/venues/okx/transport'

export const ALGO_PENDING_PATH = '/api/v5/trade/orders-algo-pending'
const TRAILING_STOP_KIND = 'move_order_stop'
// The two kinds the app's TP/SL and OCO screens place, in the one combination the endpoint accepts
// in a single call; a trailing stop is its own kind and needs a call of its own. A plain trigger
// order is left out: without the price beside it, a sell trigger cannot be told from a take-profit.
export const TP_SL_ORDER_KINDS = 'conditional,oco'
const STOP_ORDER_KINDS = Object.freeze([TP_SL_ORDER_KINDS, TRAILING_STOP_KIND] as const)
export const SELL_SIDE = 'sell'

/** The size each symbol carries live sell stops on, summed over its orders. A trailing stop is a
 *  stop by kind; a TP/SL or OCO order is one only where it names a stop trigger. */
export async function listStopSizes(
  deps: OkxTransportDeps,
  signal: AbortSignal
): Promise<ReadonlyMap<string, number>> {
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

  const sizes = new Map<string, number>()

  for (const row of pages.flat()) {
    if (row.side === SELL_SIDE && isStop(row) && row.instId) {
      sizes.set(row.instId, (sizes.get(row.instId) ?? 0) + optionalNumber(row.sz, 0))
    }
  }

  return sizes
}

function isStop(row: OkxRow): boolean {
  return row.ordType === TRAILING_STOP_KIND || (row.slTriggerPx ?? '') !== ''
}
