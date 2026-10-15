import { z } from 'zod'

import type { DisplayText } from '@/core/stream-events'
import type { ToolDefinition, ToolResult } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { RegionSchema } from '@/trading/kernel/surface/surface'
import { createTool } from '@/core/tool'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { renderScoreBand } from '@/trading/render/format'
import { renderRegionName } from '@/trading/render/tool-detail'

export function createMacroRiskTool(
  marketData: MarketDataService,
  regions: RegionSchema
): ToolDefinition {
  return createTool({
    name: 'macro_risk',
    description:
      "Get the macro regime for one region and the drivers that voted for it, each with its value, its share of the vote and the date it was read. Each region weighs its own table, so read the drivers rather than assuming them: a series named `us-*` is a US reading wherever it appears, never the requested region's own, so never quote `us-inflation-yoy` as that region's inflation or judge it against its central bank's target.",
    inputSchema: z.strictObject({ region: regions }),
    capability: 'net',
    eager: true,
    presentation: {
      label: 'Macro risk',
      emoji: '🌐',
      detail: (input, locale) => renderRegionName(locale, input.region),
    },
    async execute(args, ctx): Promise<ToolResult> {
      const now = Date.now()
      const result = await marketData.macroRisk({
        region: args.region,
        now,
        signal: ctx.signal,
      })

      const agentResult =
        result.kind === 'available'
          ? { ...result, value: agentMacro(result.value, ctx.locale) }
          : result

      return { content: toAgentJson(agentResult), isError: false, display: macroDisplay(result) }
    },
  })
}

/** The driver count is the trust signal: a regime read from two of four inputs is not the same
 *  claim as one read from all four. */
function macroDisplay(result: SourceResult<MacroRiskView>): DisplayText {
  if (result.kind === 'unavailable') {
    return { key: 'toolSummaries.macroUnavailable' }
  }

  return {
    key: 'toolSummaries.macroRegime',
    params: {
      regime: { key: `trading.regime.${result.value.regime}` },
      drivers: result.value.drivers.length,
    },
  }
}

/** The regime is the verdict; the composite score and each driver's contribution are the arithmetic
 *  behind it, so a model reads a driver's lean as its band and never quotes the raw number. */
export function agentMacro(view: MacroRiskView, locale: Locale): unknown {
  const { score: _score, drivers, ...rest } = view

  return {
    ...rest,
    drivers: drivers.map(({ contribution, ...driver }) => ({
      ...driver,
      ...(driver.weight > 0 ? { band: renderScoreBand(locale, contribution / driver.weight) } : {}),
    })),
  }
}
