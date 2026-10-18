import type { DisplayText } from '@/core/stream-events'
import type { ToolDefinition, ToolResult } from '@/core/tool'
import type { AgentPortfolio, RebalancePlanResult } from '@/trading/features/portfolio/types'
import { createTool } from '@/core/tool'
import { pluralKey } from '@/i18n'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { noInput } from '@/trading/kernel/surface/surface'

export function createPortfolioRebalanceTool(portfolio: AgentPortfolio): ToolDefinition {
  return createTool({
    name: 'portfolio_rebalance',
    description:
      'Propose portfolio changes: segment targets, per-position buys and sells, and the cash segment. A line carrying `units` states the quantity to buy or sell: always give that number.',
    inputSchema: noInput,
    capability: 'read',
    presentation: { label: 'Rebalance', emoji: '⚖️' },
    async execute(_args, ctx): Promise<ToolResult> {
      const options = { now: Date.now(), signal: ctx.signal }
      const advice =
        ctx.audience === 'operator'
          ? await portfolio.rebalanceWithUnits(options)
          : await portfolio.rebalance(options)

      return {
        content: toAgentJson(advice),
        isError: false,
        display: adviceDisplay(advice),
      }
    },
  })
}

/** Without this line an advice that could not be sized reads exactly like one that found nothing
 *  to change. */
function adviceDisplay(advice: RebalancePlanResult): DisplayText {
  if (advice.kind === 'unavailable') {
    return { key: `trading.advice.unavailable.${advice.reason}` }
  }

  const count = advice.rebalance.length

  return count === 0
    ? { key: 'toolSummaries.adviceNoChanges' }
    : {
        key: pluralKey(count, 'toolSummaries.adviceRowsOne', 'toolSummaries.adviceRows'),
        params: { count },
      }
}
