import type { TradingHost, TradingHostDeps } from '@/trading/wiring/host/types'
import { accountMethods } from '@/trading/wiring/host/account'
import { agentMethods } from '@/trading/wiring/host/agents'
import { ledgerMethods } from '@/trading/wiring/host/ledger'
import { marketMethods } from '@/trading/wiring/host/market'
import { orderMethods } from '@/trading/wiring/host/order'
import { profileMethods } from '@/trading/wiring/host/profile'
import { themeMethods } from '@/trading/wiring/host/themes'

/** Composed from seven parts purely to keep each readable: the market-data reads, the reads and
 *  writes scoped to the operator's own account, the agents' records, the ledger, orders, the
 *  profile's watchlist and setup, and the themes. All obey the one-service-call rule. */
export function createTradingHost(deps: TradingHostDeps): TradingHost {
  return {
    ...marketMethods(deps),
    ...accountMethods(deps),
    ...agentMethods(deps),
    ...ledgerMethods(deps),
    ...orderMethods(deps),
    ...profileMethods(deps),
    ...themeMethods(deps),
  }
}
