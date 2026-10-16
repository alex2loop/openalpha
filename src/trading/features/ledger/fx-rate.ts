import type { LedgerTxn, LedgerTxnDraftInput, LedgerTxnKind } from '@/trading/features/ledger/types'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import type { Book } from '@/trading/kernel/operator/book'

/** The kinds that spend currency cash at its cost. A deposit, withdrawal, sale or dividend is
 *  priced by the row's own rate. */
const PAID_FROM_CURRENCY_CASH: ReadonlySet<LedgerTxnKind> = new Set([
  'buy',
  'rights',
  'fee',
  'loss',
  'transfer',
])

/** A row in another currency that names no rate and did not accept the market's: the day's market
 *  rate would stand in for what the operator actually paid. */
export function asksForFxRate(draft: LedgerTxnDraftInput, baseCurrency: CurrencyCode): boolean {
  return 'currency' in draft && draft.currency !== baseCurrency && !namesFxRate(draft)
}

/** Whether the row carries `fx <rate>` or `fx auto`. */
export function namesFxRate(draft: LedgerTxnDraftInput): boolean {
  return (
    'currency' in draft && (draft.operatorFxRate !== undefined || draft.fxRateConfirmed === true)
  )
}

/** Whether the rate changes what this row records. It does where money crosses between the base
 *  and the other currency: a deposit, a withdrawal, and a trade at a venue holding none of that
 *  currency. Spending or receiving currency cash the venue already holds is priced by its cost. */
export function fxRateApplies(book: Book, txn: LedgerTxn): boolean {
  if (!('currency' in txn) || txn.currency === book.baseCurrency) {
    return false
  }

  if (txn.kind === 'deposit' || txn.kind === 'withdrawal') {
    return true
  }

  if (txn.kind === 'buy' || txn.kind === 'sell' || txn.kind === 'rights') {
    return !holdsCurrencyCash(book, txn)
  }

  return false
}

/** A row paid out of the venue's currency cash: its base cost is that cash's average cost, not the
 *  row's rate. */
export function paysFromCurrencyCash(book: Book, txn: LedgerTxn): boolean {
  if (!('currency' in txn) || txn.currency === book.baseCurrency) {
    return false
  }

  if (!PAID_FROM_CURRENCY_CASH.has(txn.kind)) {
    return false
  }

  return holdsCurrencyCash(book, txn)
}

/** Checked against the cash's opening day, since the book may be folded past the row. */
function holdsCurrencyCash(book: Book, txn: LedgerTxn): boolean {
  if (!('currency' in txn)) {
    return false
  }

  const venue = txn.kind === 'transfer' ? txn.fromVenue : txn.venue

  return book.currencyCash.some(
    (cash) => cash.venue === venue && cash.currency === txn.currency && cash.openedAt <= txn.at
  )
}
