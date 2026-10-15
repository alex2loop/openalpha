import type { ToolDefinition } from '@/core/tool'
import type { MarketDataService } from '@/trading/features/market-data/types'
import { createTool } from '@/core/tool'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import {
  dayRangeInput,
  instrumentQueryInput,
  type MarketSchema,
} from '@/trading/kernel/surface/surface'

export function createMarketBarsTool(
  marketData: MarketDataService,
  markets: MarketSchema
): ToolDefinition {
  return createTool({
    name: 'market_bars',
    description:
      'Daily OHLC bars (candles) with volume and traded value for one instrument over a day range - the first-party answer to any question about its price history or trading volume, which must never come from the web. Bar prices are plain numbers in whole currency units - a VN share in đồng, not board points - so read them for the shape of the move and quote a level from market_price, which writes it the way the board shows it.',
    inputSchema: dayRangeInput.extend(instrumentQueryInput(markets)),
    inputExamples: [{ ticker: 'FPT', fromDay: '2026-08-01', toDay: '2026-09-12' }],
    capability: 'net',
    eager: true,
    presentation: { label: 'Bars', emoji: '📉', detailKeys: ['ticker'] },
    async execute(args, ctx): Promise<string> {
      const result = await marketData.bars({
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
