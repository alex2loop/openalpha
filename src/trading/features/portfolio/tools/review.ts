import type { ToolDefinition } from '@/core/tool'
import type { AgentPortfolio } from '@/trading/features/portfolio/types'
import { createTool } from '@/core/tool'
import { segmentNames } from '@/trading/features/portfolio/render/segments'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { noInput } from '@/trading/kernel/surface/surface'

export function createPortfolioReviewTool(portfolio: AgentPortfolio): ToolDefinition {
  return createTool({
    name: 'portfolio_review',
    description:
      'Report concentration, drift, and quality findings for the portfolio. Name a segment by `segmentNames`, never by its id.',
    inputSchema: noInput,
    capability: 'read',
    presentation: { label: 'Portfolio review', emoji: '📊' },
    async execute(_args, ctx): Promise<string> {
      const assessment = await portfolio.assess({
        now: Date.now(),
        signal: ctx.signal,
      })

      return toAgentJson({
        ...assessment,
        segmentNames: segmentNames(ctx.locale, [], assessment.findings),
      })
    },
  })
}
