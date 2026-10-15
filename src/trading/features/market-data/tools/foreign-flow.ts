import type { ToolDefinition } from '@/core/tool'
import type { Locale } from '@/core/types/locale'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { FlowSnapshot } from '@/trading/kernel/market/market-data'
import { createTool } from '@/core/tool'
import { mapSourceValue } from '@/trading/kernel/source/source-result'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { dayRangeInput, tickerInput } from '@/trading/kernel/surface/surface'
import { formatFlow, formatSignedFlow } from '@/trading/render/format'

export function createVnForeignFlowTool(marketData: MarketDataService): ToolDefinition {
  return createTool({
    name: 'vn_foreign_flow',
    description:
      'Daily foreign and proprietary-desk net buying and selling on the VN market over a day range, for the whole market or one ticker - the first-party answer to "what did foreigners buy or sell", never the web. A market total spans every board the market admits, HOSE and HNX together, so it runs above the HOSE-only figure a broker screen or a press headline prints: call it the market, never one exchange. Two desks and nothing finer: the rows carry no fund, investor or broker breakdown, so never name or count those.',
    inputSchema: dayRangeInput.extend({ ticker: tickerInput.optional() }),
    capability: 'net',
    eager: true,
    presentation: { label: 'Foreign flow', emoji: '💱', detailKeys: ['ticker'] },
    async execute(args, ctx): Promise<string> {
      const result = await marketData.flows({
        ...(args.ticker === undefined ? {} : { ticker: args.ticker }),
        fromDay: args.fromDay,
        toDay: args.toDay,
        now: Date.now(),
        signal: ctx.signal,
      })

      return toAgentJson(
        mapSourceValue(result, (rows) => rows.map((row) => toPayload(row, ctx.locale)))
      )
    },
  })
}

/** Money at market scale leaves as the string a reader would see, for the reason `market_overview`
 *  formats its flows: a model handed a raw twelve-digit VND figure misplaces the decimal. */
function toPayload(row: FlowSnapshot, locale: Locale): Record<string, unknown> {
  return {
    ...row,
    foreignBuyValue: formatFlow(locale, row.foreignBuyValue),
    foreignSellValue: formatFlow(locale, row.foreignSellValue),
    foreignNetValue: formatSignedFlow(locale, row.foreignNetValue),
    ...(row.proprietaryNetValue === undefined
      ? {}
      : { proprietaryNetValue: formatSignedFlow(locale, row.proprietaryNetValue) }),
  }
}
