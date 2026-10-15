import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { MarketDataService } from '@/trading/features/market-data/types'
import { createTool } from '@/core/tool'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { instrumentQueryInput, type MarketSchema } from '@/trading/kernel/surface/surface'
import { renderAccountsLines } from '@/trading/render/accounts'

export function createMarketAccountsTool(
  marketData: MarketDataService,
  markets: MarketSchema
): ToolDefinition {
  return createTool({
    name: 'market_accounts',
    description:
      "One listed company's audited annual accounts from our own filings store, oldest year first, then the last four quarters as one unaudited year where they run past the newest audit: revenue, margin, core operating profit, cash flow, capex, free cash flow, cash dividends paid, cash raised from share issues, share count, net debt, ROIC and interest cover (a bank's NII/assets, cost/income and CAR instead), the multi-year growth and cash conversion, and any flags. VN equities only; never a web figure.",
    inputSchema: z.strictObject(instrumentQueryInput(markets)),
    capability: 'net',
    presentation: { label: 'Accounts', emoji: '📒', detailKeys: ['ticker'] },
    async execute(args, ctx): Promise<string> {
      const result = await marketData.accounts({
        ticker: args.ticker,
        ...(args.market === undefined ? {} : { market: args.market }),
        now: Date.now(),
        signal: ctx.signal,
      })

      if (result.kind === 'unavailable') {
        return toAgentJson(result)
      }

      const convention = marketData.quoteConvention(result.value.instrument.market)
      const quote = convention === undefined ? {} : { currency: convention.currency }

      return renderAccountsLines(ctx.locale, result.value, quote).join('\n')
    },
  })
}
