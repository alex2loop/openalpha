import type { MarketDataService } from '@/trading/features/market-data/types'
import type { AgentPortfolio } from '@/trading/features/portfolio/types'
import type { TradingCosts } from '@/trading/kernel/config'

/** What a ledger-writing tool needs to answer with the confirmation the slash commands print. */
export interface LedgerToolDeps {
  readonly portfolio: AgentPortfolio
  readonly markets: Pick<MarketDataService, 'quoteConvention'>
  readonly costs: TradingCosts
}
