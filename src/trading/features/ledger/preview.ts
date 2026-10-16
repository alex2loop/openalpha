import type { LedgerMutateDeps } from '@/trading/features/ledger/mutate'
import type {
  FillSource,
  LedgerEntry,
  LedgerTxn,
  LedgerTxnDraft,
  LedgerTxnDraftInput,
} from '@/trading/features/ledger/types'
import type { Book } from '@/trading/kernel/operator/book'
import { foldBook } from '@/trading/features/ledger/book'
import { fxRateApplies } from '@/trading/features/ledger/fx-rate'
import { dayOf, validatorFor } from '@/trading/features/ledger/mutate'
import { resolveDraft } from '@/trading/features/ledger/resolve'
import { orderLedger } from '@/trading/features/ledger/validate'
import { finalizeTransaction } from '@/trading/features/ledger/write'
import { buildLedgerEntryId } from '@/trading/kernel/operator/book'

export interface PreviewLedgerOptions {
  readonly draft: LedgerTxnDraftInput
  readonly now: number
  readonly signal: AbortSignal
}

/** The row as it would be stored, written nowhere. */
export interface RecordPreview {
  /** The resolved draft and where its figures came from, so a confirm writes exactly this row
   *  without asking the venue again. */
  readonly draft: LedgerTxnDraft
  readonly fillSource: FillSource
  readonly transaction: LedgerTxn
  /** What the write would move the book's cash by: the fold's answer, not the row's rate times
   *  its amount, which differs once currency cash spends at average cost. */
  readonly cashChangeBase: number
  /** Whether the rate changes what the book records for this row. */
  readonly fxRateApplies: boolean
}

export async function previewRecord(
  deps: LedgerMutateDeps,
  options: PreviewLedgerOptions
): Promise<RecordPreview> {
  const { draft, fillSource } = await resolveDraft(deps, options.draft, options.signal)
  const transaction = await finalizeTransaction(deps, { draft, signal: options.signal })
  const entries = await deps.ledger.listAll(options.signal)
  const candidate: LedgerEntry = {
    id: buildLedgerEntryId(options.now),
    recordedAt: options.now,
    transaction,
  }
  const folded: { book?: Book } = {}

  // The write's own validator: a row the book would refuse is refused here, before it is held.
  validatorFor(deps, folded, options.now)([...entries, candidate])

  const ordered = orderLedger(entries)
  const before = foldBook(ordered, dayOf(deps, options.now), deps.baseCurrency)
  const after = folded.book ?? before
  const onItsDay = foldBook(ordered, transaction.at, deps.baseCurrency)

  return {
    draft,
    fillSource,
    transaction,
    cashChangeBase: after.cashBase - before.cashBase,
    fxRateApplies: fxRateApplies(onItsDay, transaction),
  }
}
