import type { Locale } from '@/core/types/locale'
import type { WriteAudience } from '@/trading/features/ledger/fee-rows'
import type { LedgerEntry, LedgerTxn } from '@/trading/features/ledger/types'
import type { InstrumentRef, MarketRef } from '@/trading/kernel/instrument'
import type { Book } from '@/trading/kernel/operator/book'
import type { QuoteConvention } from '@/trading/render/money'
import { formatDay, t } from '@/i18n'
import { paysFromCurrencyCash } from '@/trading/features/ledger/fx-rate'
import { ledgerEntryHandle } from '@/trading/features/ledger/types'
import { formatQuantity, renderVenueName } from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR } from '@/trading/render/layout'
import {
  formatMoney,
  formatRecordedMoney,
  formatRecordedPrice,
  quotedInOf,
} from '@/trading/render/money'
import { renderMarketName } from '@/trading/render/tool-detail'

interface EntryFieldOptions {
  readonly quoteConventions: ReadonlyMap<MarketRef, QuoteConvention>
  readonly audience: WriteAudience
  readonly book: Book
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
      : [
          ...renderSubjectFields(locale, transaction, options.quoteConventions),
          ...renderFxField(locale, transaction, options.book),
        ]),
    ...(transaction.note === undefined
      ? []
      : [renderField(locale, 'note', { note: transaction.note })]),
  ]
}

/** The rate a foreign row converted at, and whose it was. */
function renderFxField(locale: Locale, txn: LedgerTxn, book: Book): readonly string[] {
  if (!('conversion' in txn) || txn.conversion.fromCurrency === txn.conversion.toCurrency) {
    return []
  }

  const { conversion } = txn

  if (paysFromCurrencyCash(book, txn)) {
    return [renderField(locale, 'fxRatePaidFromCash', { currency: conversion.fromCurrency })]
  }

  // `formatMoney`, not `formatRecordedMoney`: a provider rate carries four decimals nobody paid.
  const params = {
    rate: formatMoney(locale, conversion.rate, conversion.toCurrency),
    currency: conversion.fromCurrency,
    day: formatDay(locale, conversion.asOf),
  }

  return [
    renderField(locale, conversion.source === 'operator' ? 'fxRateStated' : 'fxRateMarket', params),
  ]
}

/** The agent's receipt names the row, never its figures. */
function renderSubjectTicker(locale: Locale, txn: LedgerTxn): readonly string[] {
  return 'instrument' in txn
    ? [renderField(locale, 'ticker', { ticker: renderInstrumentLabel(locale, txn.instrument) })]
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
        ticker: renderInstrumentLabel(locale, txn.instrument),
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
    ? [
        renderField(locale, 'ticker', { ticker: renderInstrumentLabel(locale, txn.instrument) }),
        amount,
      ]
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
    ticker,
    ...quotedInOf(quoteConventions.get(txn.instrument.market)),
  })

  return [
    renderField(locale, 'quantity', {
      quantity: formatQuantity(locale, txn.quantity),
      ticker: renderInstrumentLabel(locale, txn.instrument),
    }),
    renderField(locale, 'price', { price }),
    renderField(locale, 'fee', { fee: formatRecordedMoney(locale, txn.fee, txn.currency) }),
  ]
}

/** The market rides beside the ticker on every write, so a bare ticker booked into the wrong market
 *  is visible in the confirmation and `/update` can fix it. */
function renderInstrumentLabel(locale: Locale, instrument: InstrumentRef): string {
  return `${instrument.ticker}${INLINE_SEPARATOR}${renderMarketName(locale, instrument.market)}`
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
  | 'fxRateStated'
  | 'fxRateMarket'
  | 'fxRatePaidFromCash'

function renderField(locale: Locale, name: FieldName, params: Record<string, string>): string {
  return `${INDENT[1]}${t(locale, `trading.render.ledger.field.${name}`, params)}`
}
