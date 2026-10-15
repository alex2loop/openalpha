import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { AgentPortfolio } from '@/trading/features/portfolio/types'
import { createTool } from '@/core/tool'
import { toAgentJson } from '@/trading/kernel/surface/agent-json'
import { ledgerEntryIdInput } from '@/trading/kernel/surface/surface'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

export function createPortfolioHistoryTool(portfolio: AgentPortfolio): ToolDefinition {
  return createTool({
    name: 'portfolio_history',
    description:
      'List recorded portfolio ledger entries, most recent first. Each carries the id that ' +
      'portfolio_update and portfolio_remove address.',
    inputSchema: z.strictObject({
      limit: z
        .int()
        .positive()
        .max(SURFACE_LIMITS.maximumHistoryItems)
        .optional()
        .describe(`Rows to return, newest first, up to ${SURFACE_LIMITS.maximumHistoryItems}.`),
      cursor: ledgerEntryIdInput
        .optional()
        .describe('Continue after this row id from a previous page. Omit for the first page.'),
    }),
    capability: 'read',
    presentation: { label: 'Portfolio history', emoji: '🧾' },
    async execute(args, ctx): Promise<string> {
      const page = await portfolio.historyRelative({
        limit: args.limit ?? SURFACE_LIMITS.maximumHistoryItems,
        ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
        signal: ctx.signal,
      })

      return toAgentJson(page)
    },
  })
}
