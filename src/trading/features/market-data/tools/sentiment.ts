import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { MarketSchema } from '@/trading/kernel/surface/surface'
import { createTool } from '@/core/tool'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { renderMarketName } from '@/trading/render/tool-detail'

export function createMarketSentimentTool(
  marketData: MarketDataService,
  markets: MarketSchema
): ToolDefinition {
  return createTool({
    name: 'market_sentiment',
    description:
      'One market\'s current sentiment reading (fear and greed style) from our own sources - the number to quote for "how is sentiment", never a web figure.',
    inputSchema: z.strictObject({ market: markets }),
    capability: 'net',
    presentation: {
      label: 'Sentiment',
      emoji: '🌡️',
      detail: (input, locale) => renderMarketName(locale, input.market),
    },
    async execute(args, ctx): Promise<string> {
      const now = Date.now()
      const result = await marketData.sentiment({
        market: args.market,
        now,
        signal: ctx.signal,
      })

      return toAgentJson(result)
    },
  })
}
