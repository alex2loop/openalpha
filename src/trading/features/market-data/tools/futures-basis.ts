import type { ToolDefinition } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { FuturesBasis } from '@/trading/kernel/market/market-capability'
import { createTool } from '@/core/tool'
import { fractionToPct, toAgentJson } from '@/trading/kernel/surface/agent-json'
import { dayRangeInput } from '@/trading/kernel/surface/surface'
import { formatPrice } from '@/trading/render/money'

export function createVnFuturesBasisTool(marketData: MarketDataService): ToolDefinition {
  return createTool({
    name: 'vn_futures_basis',
    description:
      'Daily VN30 futures basis - the front contract against the index - over a day range, from our own data; the positioning read for the VN market, never a web figure.',
    inputSchema: dayRangeInput,
    capability: 'net',
    presentation: { label: 'Futures basis', emoji: '📐' },
    async execute(args, ctx): Promise<string> {
      const result = await marketData.basis({
        fromDay: args.fromDay,
        toDay: args.toDay,
        now: Date.now(),
        signal: ctx.signal,
      })

      return toAgentJson(
        result.kind === 'available'
          ? { ...result, value: agentBasis(result.value, ctx.locale) }
          : result
      )
    },
  })
}

/** Index levels written as the operator reads them, the basis in percent points. */
function agentBasis(basis: FuturesBasis, locale: Locale): unknown {
  return {
    ...basis,
    spot: formatPrice(locale, basis.spot),
    future: formatPrice(locale, basis.future),
    basis: formatPrice(locale, basis.basis),
    basisPct: fractionToPct(basis.basisPct),
  }
}
