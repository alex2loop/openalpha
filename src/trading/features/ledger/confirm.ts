import type { SlashContext } from '@/core/types/command'
import type { PreviewLedgerOptions, RecordPreview } from '@/trading/features/ledger/preview'
import type { StagedRecords } from '@/trading/features/ledger/staged'
import type { LedgerTxnDraft } from '@/trading/features/ledger/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { LedgerPolicy } from '@/trading/kernel/config'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import { ValidationError } from '@/core/errors'
import { renderFxPreview } from '@/trading/features/ledger/confirm-render'
import { asksForFxRate } from '@/trading/features/ledger/fx-rate'

/** The one portfolio method the rate question calls, declared here because `ledger` does not
 *  import `portfolio`. `PortfolioService` satisfies it. */
interface RecordPreviewer {
  previewRecord(options: PreviewLedgerOptions): Promise<RecordPreview>
}

export interface FxStageDeps {
  readonly portfolio: RecordPreviewer
  readonly staged: StagedRecords
  readonly baseCurrency: CurrencyCode
  readonly policy: LedgerPolicy
  readonly marketData: Pick<MarketDataService, 'quoteConvention'>
}

/** A row the day's market rate would price is shown and held instead of written. Undefined when it
 *  can be written as it stands. */
export async function stageForFxRate(
  deps: FxStageDeps,
  ctx: SlashContext,
  request: Omit<PreviewLedgerOptions, 'signal'>
): Promise<string | undefined> {
  if (!asksForFxRate(request.draft, deps.baseCurrency)) {
    return undefined
  }

  const preview = await deps.portfolio.previewRecord({ ...request, signal: ctx.signal })

  if (!preview.fxRateApplies) {
    return undefined
  }

  deps.staged.stage(ctx.sessionId, {
    draft: withPreviewedRate(preview),
    fillSource: preview.fillSource,
    requestId: ctx.requestId,
  })

  return renderFxPreview(ctx.locale, preview, {
    marketData: deps.marketData,
    ttlMs: deps.policy.confirmTtlMs,
  })
}

/** The held row keeps the rate its preview showed: a confirm that asked the market again could book
 *  a cash change the operator never saw. */
function withPreviewedRate(preview: RecordPreview): LedgerTxnDraft {
  const { draft, transaction } = preview

  return 'conversion' in transaction && 'currency' in draft
    ? { ...draft, previewedConversion: transaction.conversion }
    : draft
}

/** The agent's form of the same question: refused, so the model asks the operator instead of
 *  choosing a rate for them. */
export async function assertFxRateStated(
  deps: Pick<FxStageDeps, 'portfolio' | 'baseCurrency'>,
  options: PreviewLedgerOptions
): Promise<void> {
  const { draft } = options

  if (!asksForFxRate(draft, deps.baseCurrency)) {
    return
  }

  const preview = await deps.portfolio.previewRecord(options)

  if (preview.fxRateApplies && 'currency' in draft) {
    throw new ValidationError(`no rate stated for a ${draft.currency} row`, {
      key: 'errors.ledgerFxRateUnstated',
      params: { currency: draft.currency },
    })
  }
}
