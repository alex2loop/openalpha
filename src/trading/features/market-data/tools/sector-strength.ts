import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { MarketSchema } from '@/trading/kernel/surface/surface'
import { createTool } from '@/core/tool'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { formatSignedFlow, renderProvidedValue } from '@/trading/render/format'
import { renderMarketName } from '@/trading/render/tool-detail'

export function createMarketSectorStrengthTool(
  marketData: MarketDataService,
  markets: MarketSchema
): ToolDefinition {
  return createTool({
    name: 'market_sector_strength',
    description:
      'Rank the sectors and industries of one market by relative strength against its index - which sectors are leading and which are lagging, for sector rotation and the open-ended "which sector or industry should I buy" question. Sectors arrive strongest first. `excessReturnShort` and `excessReturnLong` measure leadership over 20 and 60 sessions as fractions (0.05 is 5%), never today, and a market whose own index could not be read publishes neither: `sessionReturn` is the only field that answers "which sector rose today", and a sector that did not trade this session has none. Buckets are ICB level 2, so GAS distributes gas and files under utilities, not oil and gas; a press "dầu khí" table groups the PetroVietnam family instead and will not match member for member - say which you quoted. `sessionReturn` blends every board the market admits, capitalisation-weighted, while a broker screen usually shows one board: it reads a few tenths off theirs, and further on a small sector - say that yours spans the whole market. Each `sector` arrives already written in the operator\'s language: quote it exactly and never translate one yourself. Deterministic, no LLM. Deepen a favored sector with market_screen, then suggestion_run for one name.',
    inputSchema: z.strictObject({ market: markets }),
    capability: 'net',
    eager: true,
    presentation: {
      label: 'Sector strength',
      emoji: '🏭',
      detail: (input, locale) => renderMarketName(locale, input.market),
    },
    async execute(args, ctx): Promise<string> {
      const result = await marketData.sectors({
        market: args.market,
        now: Date.now(),
        signal: ctx.signal,
      })
      const sectors = result.sectors.map(({ score: _score, ...entry }) => ({
        ...entry,
        sector: renderProvidedValue(ctx.locale, `trading.sector.${entry.sector}`, entry.sector),
        foreignNetBase: formatSignedFlow(ctx.locale, entry.foreignNetBase),
      }))

      return toAgentJson({ ...result, sectors })
    },
  })
}
