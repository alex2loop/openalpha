import { z } from 'zod'

import type { BinanceTransportDeps } from '@/trading/venues/binance/transport'
import type { VenueKeyRestrictions } from '@/trading/venues/types'
import { OrderError } from '@/trading/features/order/types'
import { signedRequest } from '@/trading/venues/binance/transport'

const API_RESTRICTIONS_PATH = '/sapi/v1/account/apiRestrictions'
const API_RESTRICTIONS = z.object({
  ipRestrict: z.boolean(),
  enableWithdrawals: z.boolean(),
  enableSpotAndMarginTrading: z.boolean(),
})

export async function fetchBinanceKeyRestrictions(
  deps: BinanceTransportDeps,
  signal: AbortSignal
): Promise<VenueKeyRestrictions> {
  const answer = await signedRequest(deps, {
    path: API_RESTRICTIONS_PATH,
    method: 'GET',
    schema: API_RESTRICTIONS,
    signal,
  })

  if (answer === undefined) {
    throw new OrderError('order.network', 'binance answered no key restrictions')
  }

  return {
    withdrawals: answer.enableWithdrawals,
    ipRestricted: answer.ipRestrict,
    trading: answer.enableSpotAndMarginTrading,
  }
}
