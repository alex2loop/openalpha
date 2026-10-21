import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type { LedgerTxn, LedgerTxnDraft } from '@/trading/features/ledger/types'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import type { LedgerEntryId } from '@/trading/kernel/operator/book'
import { ValidationError } from '@/core/errors'
import { foldBook } from '@/trading/features/ledger/book'
import { asksForFxRate, fxRateApplies, namesFxRate } from '@/trading/features/ledger/fx-rate'
import { orderLedger } from '@/trading/features/ledger/validate'
import { venueParam } from '@/trading/render/format'

interface FxUsedDeps {
  readonly ledger: Pick<LedgerStore, 'listAll'>
  readonly baseCurrency: CurrencyCode
}

/** A named rate the row cannot use is refused rather than dropped, or the operator would believe it
 *  was booked. An edit restates the whole row, so one that names no rate is refused where the rate
 *  applies; a record asks earlier, by preview. The ledger is read again only when the rate matters. */
export async function assertFxRateUsed(
  deps: FxUsedDeps,
  input: {
    readonly draft: LedgerTxnDraft
    readonly transaction: LedgerTxn
    readonly replacing?: LedgerEntryId
    readonly signal: AbortSignal
  }
): Promise<void> {
  const { draft, transaction, replacing } = input
  const named = namesFxRate(draft)
  const unstated = replacing !== undefined && asksForFxRate(draft, deps.baseCurrency)

  if (!('currency' in transaction && (named || unstated))) {
    return
  }

  const entries = await deps.ledger.listAll(input.signal)
  const others = entries.filter((entry) => entry.id !== replacing)
  const book = foldBook(orderLedger(others), transaction.at, deps.baseCurrency)
  const applies = fxRateApplies(book, transaction)

  if (applies && unstated) {
    throw new ValidationError(`no rate stated for a ${transaction.currency} row`, {
      key: 'errors.ledgerFxRateUnstated',
      params: { currency: transaction.currency },
    })
  }

  if (named && !applies) {
    const venue = transaction.kind === 'transfer' ? transaction.fromVenue : transaction.venue

    throw new ValidationError(`${transaction.currency} row at ${venue} takes no exchange rate`, {
      key: 'errors.ledgerFxPaidFromCash',
      params: { currency: transaction.currency, venue: venueParam(venue) },
    })
  }
}
