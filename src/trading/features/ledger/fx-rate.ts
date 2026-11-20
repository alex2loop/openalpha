import type {
  LedgerEntry,
  LedgerTxn,
  LedgerTxnDraftInput,
  LedgerTxnKind,
} from '@/trading/features/ledger/types'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import type { Book, CurrencyCash, LedgerEntryId } from '@/trading/kernel/operator/book'
import { isOrderedBefore } from '@/trading/features/ledger/ordering'

/** The kinds that spend currency cash at its cost, so a rate stated on them prices nothing. */
const PAID_FROM_CURRENCY_CASH: ReadonlySet<LedgerTxnKind> = new Set([
  'buy',
  'rights',
  'fee',
  'loss',
  'transfer',
])

/** A row as it lands: an edit keeps its id, a new row has none yet. */
interface LandingRow {
  readonly id: LedgerEntryId | undefined
  readonly transaction: LedgerTxn
}

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

/** How a row in another currency than the base takes a rate. `asked`: money crosses between the
 *  two (a deposit, a withdrawal, a trade at a venue holding none of that currency), so the row asks
 *  for the rate the operator paid. `accepted`: a sale into currency cash or a dividend converts
 *  nothing and takes the day's market rate unless one is stated, which a day the provider has no
 *  rate for needs. `refused`: a row paid from held currency cash at its cost, or one in the base. */
export function fxRateUseOf(book: Book, row: LandingRow): 'asked' | 'accepted' | 'refused' {
  const txn = row.transaction

  if (!isForeignCurrencyRow(book, txn)) {
    return 'refused'
  }

  if (txn.kind === 'deposit' || txn.kind === 'withdrawal') {
    return 'asked'
  }

  const isTrade = txn.kind === 'buy' || txn.kind === 'sell' || txn.kind === 'rights'

  if (isTrade && !holdsCurrencyCash(book, row)) {
    return 'asked'
  }

  return txn.kind === 'sell' || txn.kind === 'dividend' ? 'accepted' : 'refused'
}

/** A row paid out of the venue's currency cash: its base cost is that cash's average cost, not the
 *  row's rate. */
export function paysFromCurrencyCash(book: Book, entry: LedgerEntry): boolean {
  const txn = entry.transaction

  if (!(isForeignCurrencyRow(book, txn) && PAID_FROM_CURRENCY_CASH.has(txn.kind))) {
    return false
  }

  return holdsCurrencyCash(book, entry)
}

function isForeignCurrencyRow(book: Book, txn: LedgerTxn): boolean {
  return 'currency' in txn && txn.currency !== book.baseCurrency
}

/** Whether the venue held the row's currency when the row landed. The book may be folded past the
 *  row, so the cash counts only where the row that opened it comes first in ledger order; a new row
 *  lands after every row the book holds. */
function holdsCurrencyCash(book: Book, row: LandingRow): boolean {
  const cash = currencyCashOf(book, row.transaction)

  if (cash === undefined) {
    return false
  }

  const opened = { id: cash.openedBy, transaction: { at: cash.openedAt } }

  return (
    row.id === undefined || isOrderedBefore(opened, { id: row.id, transaction: row.transaction })
  )
}

/** The currency cash the row would pay from: its currency at the venue it pays out of. */
function currencyCashOf(book: Book, txn: LedgerTxn): CurrencyCash | undefined {
  if (!('currency' in txn)) {
    return undefined
  }

  const venue = txn.kind === 'transfer' ? txn.fromVenue : txn.venue

  return book.currencyCash.find((cash) => cash.venue === venue && cash.currency === txn.currency)
}
