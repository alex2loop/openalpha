import type { ToolDefinition } from '@/core/tool'
import type { MarketDataService } from '@/trading/features/market-data/types'
import { createTool } from '@/core/tool'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import {
  dayRangeInput,
  instrumentQueryInput,
  type MarketSchema,
} from '@/trading/kernel/surface/surface'
import { joinToolDetail, renderMarketName } from '@/trading/render/tool-detail'

export function createMarketEventsTool(
  marketData: MarketDataService,
  markets: MarketSchema
): ToolDefinition {
  return createTool({
    name: 'market_events',
    description:
      'Corporate events for one ticker over a day range - ex-dividend dates, AGMs, splits, listings, delistings, margin eligibility - from our own calendar rather than the web.',
    inputSchema: dayRangeInput.extend(instrumentQueryInput(markets)),
    capability: 'net',
    // Eager for the reason market_overview is: asked what a ticker has coming up, a model that
    // cannot see this searches the web four times and reads a filing we already store.
    eager: true,
    presentation: {
      label: 'Corporate events',
      emoji: '📅',
      detail: (input, locale) =>
        joinToolDetail([
          input.ticker,
          input.market === undefined ? undefined : renderMarketName(locale, input.market),
        ]),
    },
    async execute(args, ctx): Promise<string> {
      const result = await marketData.events({
        ticker: args.ticker,
        ...(args.market === undefined ? {} : { market: args.market }),
        fromDay: args.fromDay,
        toDay: args.toDay,
        now: Date.now(),
        signal: ctx.signal,
      })

      return toAgentJson(result)
    },
  })
}
