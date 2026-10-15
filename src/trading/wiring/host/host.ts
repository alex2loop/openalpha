import type { TradingHost, TradingHostDeps } from '@/trading/wiring/host/types'
import { accountMethods } from '@/trading/wiring/host/account'
import { agentMethods } from '@/trading/wiring/host/agents'
import { ledgerMethods } from '@/trading/wiring/host/ledger'
import { marketMethods } from '@/trading/wiring/host/market'
import { orderMethods } from '@/trading/wiring/host/order'

/** Composed from five parts purely to keep each readable: the market-data reads, the reads and
 *  writes scoped to the operator's own account, the agents' records, the ledger, and orders. All obey the
 *  one-service-call rule. */
export function createTradingHost(deps: TradingHostDeps): TradingHost {
  return {
    ...marketMethods(deps),
    ...accountMethods(deps),
    ...agentMethods(deps),
    ...ledgerMethods(deps),
    ...orderMethods(deps),
  }
}
