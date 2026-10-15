import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { MarketDataService } from '@/trading/features/market-data/types'
import { createTool } from '@/core/tool'
import { mapSourceValue } from '@/trading/kernel/source/source-result'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { instrumentQueryInput, type MarketSchema } from '@/trading/kernel/surface/surface'
import { formatFlow } from '@/trading/render/format'

export function createMarketFundingTool(
  marketData: MarketDataService,
  markets: MarketSchema
): ToolDefinition {
  return createTool({
    name: 'market_funding',
    description:
      'The current perpetual-futures funding rate for one crypto instrument from our own sources - the leverage and positioning read, never a web figure.',
    inputSchema: z.strictObject(instrumentQueryInput(markets)),
    capability: 'net',
    presentation: { label: 'Funding', emoji: '🔁', detailKeys: ['ticker'] },
    async execute(args, ctx): Promise<string> {
      const now = Date.now()
      const result = await marketData.funding({
        ticker: args.ticker,
        ...(args.market === undefined ? {} : { market: args.market }),
        now,
        signal: ctx.signal,
      })

      // Open interest is money at market scale, so it leaves formatted for the same reason
      // `market_overview` formats its own copy of the figure.
      return toAgentJson(
        mapSourceValue(result, (snapshot) =>
          snapshot.openInterestUsd === undefined
            ? snapshot
            : { ...snapshot, openInterestUsd: formatFlow(ctx.locale, snapshot.openInterestUsd) }
        )
      )
    },
  })
}
