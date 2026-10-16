import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { LedgerTxnDraft } from '@/trading/features/ledger/types'
import type { LedgerToolDeps } from '@/trading/features/portfolio/tools/types'
import { ValidationError } from '@/core/errors'
import { createTool } from '@/core/tool'
import { asksForFxRate } from '@/trading/features/ledger/fx-rate'
import { renderWriteReceipt } from '@/trading/features/ledger/render'
import { renderDraftLine } from '@/trading/features/ledger/rows'
import { ledgerEntryIdInput } from '@/trading/kernel/surface/surface'

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
    }),
    capability: 'write',
    presentation: {
      label: 'Edit transaction',
      emoji: '🩹',
      detail: (input, locale) => `[${input.id}] ${renderDraftLine(locale, input.draft, markets)}`,
    },
    async execute(args, ctx): Promise<string> {
      // An edit always restates its rate, so it is refused outright instead of previewed.
      if (asksForFxRate(args.draft, deps.baseCurrency) && 'currency' in args.draft) {
        throw new ValidationError(`no rate stated for a ${args.draft.currency} row`, {
          key: 'errors.ledgerFxRateUnstated',
          params: { currency: args.draft.currency },
        })
      }

      const result = await portfolio.update({
        ref: args.id,
        draft: args.draft,
        now: Date.now(),
        signal: ctx.signal,
      })

      return renderWriteReceipt(ctx.locale, result, { marketData: markets, costs })
    },
  })
}
