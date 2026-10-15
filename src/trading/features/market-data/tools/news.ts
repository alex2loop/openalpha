import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { MarketDataService } from '@/trading/features/market-data/types'
import { createTool } from '@/core/tool'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import {
  type MarketSchema,
  newsLimit,
  type RegionSchema,
  tickerInput,
} from '@/trading/kernel/surface/surface'
import { joinToolDetail, renderMarketName, renderRegionName } from '@/trading/render/tool-detail'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const DESCRIPTION =
  'List recent news for one instrument or market, or for a region. A market or region call returns whatever the market published, most of it about other companies: report such an item as market background, never as news about a name it does not mention.'

export function createMarketNewsTool(
  marketData: MarketDataService,
  markets: MarketSchema,
  regions: RegionSchema
): ToolDefinition {
  return createTool({
    name: 'market_news',
    description: DESCRIPTION,
    inputSchema: z.strictObject({
      ticker: tickerInput.optional(),
      market: markets.optional(),
      region: regions.optional(),
      limit: newsLimit,
    }),
    capability: 'net',
    presentation: {
      label: 'News',
      emoji: '📰',
      detail: (input, locale) =>
        joinToolDetail([
          input.ticker,
          input.market === undefined ? undefined : renderMarketName(locale, input.market),
          input.region === undefined ? undefined : renderRegionName(locale, input.region),
        ]),
    },
    async execute(args, ctx): Promise<string> {
      const now = Date.now()
      const limit = args.limit ?? SURFACE_LIMITS.maximumNewsItems

      const result = await marketData.news({
        ...(args.ticker === undefined ? {} : { ticker: args.ticker }),
        ...(args.market === undefined ? {} : { market: args.market }),
        ...(args.region === undefined ? {} : { region: args.region }),
        limit,
        now,
        signal: ctx.signal,
      })

      return toAgentJson(result)
    },
  })
}
