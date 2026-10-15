import type { OpenExit } from '@/trading/kernel/venue/spot-adapter'
import type { OkxRow, OkxTransportDeps } from '@/trading/venues/okx/transport'
import { OrderError } from '@/trading/features/order/types'
import { isHashedClientOrderId } from '@/trading/venues/client-order-id'
import { optionalNumber } from '@/trading/venues/okx/receipt'
import { ALGO_PENDING_PATH, SELL_SIDE, TP_SL_ORDER_KINDS } from '@/trading/venues/okx/stops'
import {
  CLIENT_ORDER_ID_LENGTH,
  privateRequest,
  SPOT_INST_TYPE,
} from '@/trading/venues/okx/transport'

const PAGE_SIZE = 100
// A walk that has not ended by now is a cursor the venue ignored, not an account with 2,000 exits.
const MAXIMUM_PAGES = 20

/** The live trigger orders placed under this tree's client id shape. OKX lists them without a
 *  symbol, newest first, so every page is walked: a list cut at the first page would call the
 *  account clean. */
export async function listOpenExits(
  deps: OkxTransportDeps,
  signal: AbortSignal
): Promise<readonly OpenExit[]> {
  const rows = await walkPending(deps, signal)

  return rows.flatMap((row) => {
    const exit = toOpenExit(row)

    return exit === undefined ? [] : [exit]
  })
}

async function walkPending(
  deps: OkxTransportDeps,
  signal: AbortSignal
): Promise<readonly OkxRow[]> {
  const rows: OkxRow[] = []
  let after: string | undefined

  for (let page = 0; page < MAXIMUM_PAGES; page += 1) {
    const batch = await privateRequest(deps, {
      method: 'GET',
      path: ALGO_PENDING_PATH,
      query: {
        instType: SPOT_INST_TYPE,
        ordType: TP_SL_ORDER_KINDS,
        limit: String(PAGE_SIZE),
        ...(after === undefined ? {} : { after }),
      },
      signal,
    })

    rows.push(...batch)
    after = batch.at(-1)?.algoId

    if (batch.length < PAGE_SIZE || after === undefined || after === '') {
      return rows
    }
  }

  throw new OrderError('order.network', 'the pending trigger orders did not end')
}

function toOpenExit(row: OkxRow): OpenExit | undefined {
  const { algoId, algoClOrdId, instId } = row

  if (
    row.side !== SELL_SIDE ||
    !algoId ||
    !instId ||
    !algoClOrdId ||
    !isHashedClientOrderId(algoClOrdId, CLIENT_ORDER_ID_LENGTH)
  ) {
    return undefined
  }

  const takeProfit = optionalNumber(row.tpTriggerPx, 0)
  const stopLoss = optionalNumber(row.slTriggerPx, 0)

  return {
    symbol: instId,
    exitId: algoId,
    exitClientId: algoClOrdId,
    size: optionalNumber(row.sz, 0),
    ...(takeProfit > 0 ? { takeProfit } : {}),
    ...(stopLoss > 0 ? { stopLoss } : {}),
  }
}
