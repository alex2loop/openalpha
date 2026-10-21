import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { LedgerTxnDraft } from '@/trading/features/ledger/types'
import type { LedgerToolDeps } from '@/trading/features/portfolio/tools/types'
import { createTool } from '@/core/tool'
import { renderWriteReceipt } from '@/trading/features/ledger/render'
import { renderDraftLine } from '@/trading/features/ledger/rows'
import {
  ledgerEntryIdInput,
  priceConfirmedInput,
  toTypedPrice,
} from '@/trading/kernel/surface/surface'

export function createPortfolioUpdateTool(
  deps: LedgerToolDeps & { readonly draft: z.ZodType<LedgerTxnDraft> }
): ToolDefinition {
  const { portfolio, draft, markets, costs } = deps

  return createTool({
    name: 'portfolio_update',
    description:
      'Edit one recorded ledger transaction in place — fix a wrong day, price, quantity, or note.',
    inputSchema: z.strictObject({
      id: ledgerEntryIdInput,
      draft: draft.describe('The whole transaction as it should stand after the edit, not a diff.'),
      priceConfirmed: priceConfirmedInput,
    }),
    capability: 'write',
    presentation: {
      label: 'Edit transaction',
      emoji: '🧾',
      detail: (input, locale) => `[${input.id}] ${renderDraftLine(locale, input.draft, markets)}`,
    },
    async execute(args, ctx): Promise<string> {
      const result = await portfolio.update({
        ref: args.id,
        draft: args.draft,
        typedPrice: toTypedPrice(args.priceConfirmed),
        now: Date.now(),
        signal: ctx.signal,
      })

      return renderWriteReceipt(ctx.locale, result, { marketData: markets, costs })
    },
  })
}
