import type { ToolDefinition } from '@/core/tool'
import type { AgentPortfolio } from '@/trading/features/portfolio/types'
import { createTool } from '@/core/tool'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { noInput } from '@/trading/kernel/surface/surface'

export function createPortfolioViewTool(portfolio: AgentPortfolio): ToolDefinition {
  return createTool({
    name: 'portfolio_view',
    description:
      'Show current portfolio holdings: open positions with weight as a percent of NAV and settlement state, and whether each position already closed made or lost money. It carries no cost, quantity, price or amount: `/portfolio` shows those to the operator, so point there, and never estimate them or ask the operator for them. Every weight is marked at the last settled close, never at what a name is trading at now, so say which session it describes rather than calling it the current value. A live price from market_price belongs to a different instant: never quote one beside a weight from this tool as though both described the same moment.',
    inputSchema: noInput,
    capability: 'read',
    // Eager for the reason market_price is, one step closer to home: a model that cannot see the
    // book asks the operator for an entry and a size the ledger already holds, and then sizes its
    // advice on the answer. It takes no input, so the schema it ships each turn is one line.
    eager: true,
    presentation: { label: 'Portfolio', emoji: '📊' },
    async execute(_args, ctx): Promise<string> {
      const view = await portfolio.viewRelative({
        now: Date.now(),
        signal: ctx.signal,
      })

      return toAgentJson(view)
    },
  })
}
