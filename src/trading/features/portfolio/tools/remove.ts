import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { LedgerToolDeps } from '@/trading/features/portfolio/tools/types'
import { createTool } from '@/core/tool'
import { renderWriteReceipt } from '@/trading/features/ledger/render'
import { ledgerEntryIdInput } from '@/trading/kernel/surface/surface'

export function createPortfolioRemoveTool(deps: LedgerToolDeps): ToolDefinition {
  const { portfolio, markets, costs } = deps

  return createTool({
    name: 'portfolio_remove',
    description:
      'Delete one recorded ledger transaction — a duplicate, or a trade that never happened. Use ' +
      'portfolio_update instead to fix a wrong value. Bookkeeping only: it does not reverse ' +
      'anything at a broker.',
    inputSchema: z.strictObject({ id: ledgerEntryIdInput }),
    capability: 'write',
    presentation: { label: 'Delete transaction', emoji: '🗑️', detailKeys: ['id'] },
    async execute(args, ctx): Promise<string> {
      const result = await portfolio.remove({ ref: args.id, now: Date.now(), signal: ctx.signal })

      return renderWriteReceipt(ctx.locale, result, { marketData: markets, costs })
    },
  })
}
