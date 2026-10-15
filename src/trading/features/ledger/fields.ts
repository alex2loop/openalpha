import type { Locale } from '@/core/types/locale'
import type { WriteAudience } from '@/trading/features/ledger/fee-rows'
import type { LedgerEntry, LedgerTxn } from '@/trading/features/ledger/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { QuoteConvention } from '@/trading/render/money'
import { formatDay, t } from '@/i18n'
import { ledgerEntryHandle } from '@/trading/features/ledger/types'
import { formatQuantity, renderVenueName } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { formatRecordedMoney, formatRecordedPrice, quotedInOf } from '@/trading/render/money'

interface EntryFieldOptions {
  readonly quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
  readonly audience: WriteAudience
}

/** One written row as labelled fields. A confirmation is read alone, against what the operator
 *  meant to store, so every figure is named; the history row stays a row, because a field list
 *  repeated down a page cannot be scanned. */
export function renderEntryFields(
  locale: Locale,
  entry: LedgerEntry,
  options: EntryFieldOptions
): readonly string[] {
  const { transaction } = entry

  return [
    renderField(locale, 'handle', { handle: ledgerEntryHandle(entry.id) }),
    renderField(locale, 'kind', { kind: t(locale, `trading.ledger.kind.${transaction.kind}`) }),
    renderField(locale, 'day', { day: formatDay(locale, transaction.at) }),
    ...('fromVenue' in transaction
      ? [
          renderField(locale, 'fromVenue', {
            fromVenue: renderVenueName(locale, transaction.fromVenue),
          }),
        ]
      : []),
    ...('venue' in transaction
      ? [renderField(locale, 'venue', { venue: renderVenueName(locale, transaction.venue) })]
      : []),
    ...(options.audience === 'receipt'
      ? renderSubjectTicker(locale, transaction)
      : renderSubjectFields(locale, transaction, options.quoteConventions)),
    ...(transaction.note === undefined
      ? []
      : [renderField(locale, 'note', { note: transaction.note })]),
  ]
}

/** The agent's receipt names the row, never its figures. */
function renderSubjectTicker(locale: Locale, txn: LedgerTxn): readonly string[] {
  return 'instrument' in txn
    ? [renderField(locale, 'ticker', { ticker: txn.instrument.ticker })]
    : []
}

/** Narrowed by shape rather than by kind, as `renderTxnDetail` is: a split never prints a price it
 *  never had. */
function renderSubjectFields(
  locale: Locale,
  txn: LedgerTxn,
  quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
): readonly string[] {
  if ('quantityDelta' in txn) {
    return [
      renderField(locale, 'delta', {
        delta: formatQuantity(locale, txn.quantityDelta),
        ticker: txn.instrument.ticker,
      }),
    ]
  }

  if ('unitPrice' in txn) {
    return renderTradeFields(locale, txn, quoteConventions)
  }

  const amount = renderField(locale, 'amount', {
    amount: formatRecordedMoney(locale, txn.amount, txn.currency),
  })

  if ('fromVenue' in txn) {
    return [
      amount,
      renderField(locale, 'fee', { fee: formatRecordedMoney(locale, txn.fee, txn.currency) }),
    ]
  }

  return 'instrument' in txn
    ? [renderField(locale, 'ticker', { ticker: txn.instrument.ticker }), amount]
    : [amount]
}

/** The ticker rides the quantity and the price rather than taking a line of its own: both are
 *  readings per unit of it, and a bare count is what an operator most often mis-scans. */
function renderTradeFields(
  locale: Locale,
  txn: Extract<LedgerTxn, { readonly unitPrice: number }>,
  quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
): readonly string[] {
  const ticker = txn.instrument.ticker
  const price = formatRecordedPrice(locale, txn.unitPrice, {
    currency: txn.currency,
    ...quotedInOf(quoteConventions.get(txn.instrument.market)),
  })

  return [
    renderField(locale, 'quantity', { quantity: formatQuantity(locale, txn.quantity), ticker }),
    renderField(locale, 'price', { price, ticker }),
    renderField(locale, 'fee', { fee: formatRecordedMoney(locale, txn.fee, txn.currency) }),
  ]
}

type FieldName =
  | 'handle'
  | 'kind'
  | 'day'
  | 'fromVenue'
  | 'venue'
  | 'ticker'
  | 'quantity'
  | 'price'
  | 'fee'
  | 'amount'
  | 'delta'
  | 'note'

function renderField(locale: Locale, name: FieldName, params: Record<string, string>): string {
  return `${INDENT[1]}${t(locale, `trading.render.ledger.field.${name}`, params)}`
}
