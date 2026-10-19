import { z } from 'zod'

import type { ToolDefinition } from '@/core/tool'
import type { LedgerTxnDraftInput } from '@/trading/features/ledger/types'
import type { LedgerToolDeps } from '@/trading/features/portfolio/tools/types'
import { createTool } from '@/core/tool'
import { assertFxRateStated } from '@/trading/features/ledger/confirm'
import { renderWriteReceipt } from '@/trading/features/ledger/render'
import { renderDraftLine } from '@/trading/features/ledger/rows'
import { priceConfirmedInput, SELL_ALL, toTypedPrice } from '@/trading/kernel/surface/surface'
import { ledgerIdempotencyKey } from '@/trading/kernel/surface/tool-approval'

/** Answers with the receipt, so the model relays the rate the fee was checked against and a stated
 *  zero comes back questioned instead of echoed. */
export function createPortfolioRecordTool(
  deps: LedgerToolDeps & { readonly draft: z.ZodType<LedgerTxnDraftInput> }
): ToolDefinition {
  const { portfolio, draft, markets, costs } = deps

  return createTool({
    name: 'portfolio_record',
    description:
      'Record one completed transaction in the operator ledger. A sale closing a position sets ' +
      `quantity to "${SELL_ALL}" instead of a count; the ledger supplies the size.`,
    inputSchema: z.strictObject({
      draft: draft.describe('The transaction to record, one arm chosen by its kind.'),
      priceConfirmed: priceConfirmedInput,
    }),
    // Cash only: every trade arm resolves a venue against the registry inside the schema, so a
    // trade example would pass or fail by configuration rather than by shape. A cash row names a
    // venue without resolving one, so the literal below is shape like the rest of the example.
    inputExamples: [
      { draft: { kind: 'deposit', at: '2026-09-12', venue: 'okx', amount: 50_000_000 } },
    ],
    capability: 'write',
    // Eager because a model that cannot see the ledger write reports it as a missing capability
    // rather than searching for it, and tells the operator their trade cannot be recorded.
    eager: true,
    presentation: {
      label: 'Record transaction',
      emoji: '🧾',
      detail: (input, locale) => renderDraftLine(locale, input.draft, markets),
    },
    async execute(args, ctx): Promise<string> {
      const now = Date.now()
      const typedPrice = toTypedPrice(args.priceConfirmed)

      await assertFxRateStated(deps, { draft: args.draft, typedPrice, now, signal: ctx.signal })

      const result = await portfolio.record({
        draft: args.draft,
        typedPrice,
        idempotencyKey: ledgerIdempotencyKey(ctx),
        now,
        signal: ctx.signal,
      })

      return renderWriteReceipt(ctx.locale, result, { marketData: markets, costs })
    },
  })
}
