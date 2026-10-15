import { z } from 'zod'

import type {
  CloseReason,
  LedgerEntry,
  LedgerTxn,
  LedgerTxnKind,
} from '@/trading/features/ledger/types'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { FxConversion } from '@/trading/kernel/market/market-capability'
import { StorageError } from '@/core/errors'
import { CLOSE_REASONS, LEDGER_TXN_KINDS } from '@/trading/features/ledger/types'
import {
  ticker as brandTicker,
  currencyCode,
  marketRef,
  tradingDay,
  venueRef,
} from '@/trading/kernel/instrument'
import { ledgerEntryId } from '@/trading/kernel/operator/book'
import { sourceId } from '@/trading/kernel/source/source-id'
import { parseJson, requireColumn } from '@/trading/kernel/store/store-row'

/** Identity and replay-guard columns, written once at insert and never edited. */
export const IDENTITY_COLUMNS: readonly string[] = [
  'id',
  'recorded_at',
  'updated_at',
  'idempotency_key',
  'request_fingerprint',
]

/** The transaction's own columns. An update rewrites exactly these plus `updated_at`, so listing
 *  them once is what keeps the insert and the update from drifting apart. */
export const TRANSACTION_COLUMNS: readonly string[] = [
  'txn_kind',
  'at',
  'settlement_day',
  'market',
  'ticker',
  'venue',
  'currency',
  'fx_rate',
  'conversion',
  'amount',
  'quantity',
  'unit_price',
  'fee',
  'quantity_delta',
  'note',
  'close_reason',
  'from_venue',
]

// Provenance only — who supplied this rate and when. The rate itself is the `fx_rate` column, so it
// can be constrained and multiplied against `amount` in SQL rather than parsed out of a blob.
const conversionSchema = z.strictObject({
  fromCurrency: z.string(),
  toCurrency: z.string(),
  source: z.enum(['identity', 'provider', 'operator']),
  sourceId: z.string().optional(),
  asOf: z.string(),
  fetchedAt: z.number().finite().optional(),
})

export interface LedgerRow {
  readonly id: string
  readonly recorded_at: number
  readonly updated_at: number | null
  readonly request_fingerprint: string
  readonly txn_kind: string
  readonly at: string
  readonly settlement_day: string
  readonly market: string | null
  readonly venue: string | null
  readonly ticker: string | null
  readonly currency: string | null
  readonly fx_rate: number | null
  readonly conversion: string | null
  readonly amount: number | null
  readonly quantity: number | null
  readonly unit_price: number | null
  readonly fee: number | null
  readonly quantity_delta: number | null
  readonly note: string | null
  readonly close_reason: string | null
  readonly from_venue: string | null
}

/** Every transaction column's value, in `TRANSACTION_COLUMNS` order. */
export function transactionColumns(transaction: LedgerTxn): readonly unknown[] {
  const instrument = 'instrument' in transaction ? transaction.instrument : undefined
  const conversion = 'conversion' in transaction ? transaction.conversion : undefined

  return [
    transaction.kind,
    transaction.at,
    transaction.settledAt,
    instrument?.market ?? null,
    instrument?.ticker ?? null,
    'venue' in transaction ? transaction.venue : null,
    'currency' in transaction ? transaction.currency : null,
    conversion?.rate ?? null,
    conversion ? JSON.stringify(toProvenance(conversion)) : null,
    ...amountColumns(transaction),
    transaction.note ?? null,
    'closeReason' in transaction ? (transaction.closeReason ?? null) : null,
    'fromVenue' in transaction ? transaction.fromVenue : null,
  ]
}

/** The five economic columns in bind order. Exactly one shape is non-null per kind, which is the
 *  same partition the table's CHECKs enforce. */
function amountColumns(transaction: LedgerTxn): readonly (number | null)[] {
  switch (transaction.kind) {
    case 'split':
    case 'distribution':
      return [null, null, null, null, transaction.quantityDelta]
    case 'buy':
    case 'sell':
    case 'rights':
      return [null, transaction.quantity, transaction.unitPrice, transaction.fee, null]
    case 'transfer':
      return [transaction.amount, null, null, transaction.fee, null]
    default:
      return [transaction.amount, null, null, null, null]
  }
}

function toProvenance(conversion: FxConversion): Omit<FxConversion, 'rate'> {
  const { rate: _rate, ...provenance } = conversion

  return provenance
}

export function toEntry(row: LedgerRow): LedgerEntry {
  return {
    id: ledgerEntryId(row.id),
    recordedAt: row.recorded_at,
    ...(row.updated_at === null ? {} : { updatedAt: row.updated_at }),
    transaction: toTxn(row),
  }
}

function toTxn(row: LedgerRow): LedgerTxn {
  const kind = toTxnKind(row.txn_kind)
  const at = tradingDay(row.at)
  const settledAt = tradingDay(row.settlement_day)
  const note = row.note === null ? {} : { note: row.note }

  if (kind === 'split' || kind === 'distribution') {
    return {
      kind,
      at,
      settledAt,
      ...note,
      instrument: toInstrument(row),
      venue: venueRef(readColumn(row.venue, row)),
      quantityDelta: readAmount(row.quantity_delta, row),
    }
  }

  const currency = currencyCode(readColumn(row.currency, row))
  const conversion = toConversion(row)

  if (kind === 'buy' || kind === 'sell' || kind === 'rights') {
    return toTradeTxn({ row, kind, at, settledAt, note, currency, conversion })
  }

  if (kind === 'dividend') {
    return toDividendTxn({ row, kind, at, settledAt, note, currency, conversion })
  }

  if (kind === 'transfer') {
    return {
      kind,
      at,
      settledAt,
      ...note,
      fromVenue: venueRef(readColumn(row.from_venue, row)),
      venue: venueRef(readColumn(row.venue, row)),
      currency,
      conversion,
      amount: readAmount(row.amount, row),
      fee: readAmount(row.fee, row),
    }
  }

  return toCashTxn({
    row,
    kind,
    at,
    settledAt,
    note,
    currency,
    conversion,
  })
}

interface TradeTxnFields {
  readonly row: LedgerRow
  readonly kind: 'buy' | 'sell' | 'rights'
  readonly at: ReturnType<typeof tradingDay>
  readonly settledAt: ReturnType<typeof tradingDay>
  readonly note: { readonly note?: string }
  readonly currency: ReturnType<typeof currencyCode>
  readonly conversion: FxConversion
}

function toTradeTxn(fields: TradeTxnFields): LedgerTxn {
  const { row, kind, at, settledAt, note, currency, conversion } = fields
  const closeReason = toCloseReason(row.close_reason)

  return {
    kind,
    at,
    settledAt,
    ...note,
    currency,
    conversion,
    instrument: toInstrument(row),
    venue: venueRef(readColumn(row.venue, row)),
    quantity: readAmount(row.quantity, row),
    unitPrice: readAmount(row.unit_price, row),
    fee: readAmount(row.fee, row),
    ...(closeReason === undefined ? {} : { closeReason }),
  }
}

interface DividendTxnFields {
  readonly row: LedgerRow
  readonly kind: 'dividend'
  readonly at: ReturnType<typeof tradingDay>
  readonly settledAt: ReturnType<typeof tradingDay>
  readonly note: { readonly note?: string }
  readonly currency: ReturnType<typeof currencyCode>
  readonly conversion: FxConversion
}

function toDividendTxn(fields: DividendTxnFields): LedgerTxn {
  const { row, kind, at, settledAt, note, currency, conversion } = fields

  return {
    kind,
    at,
    settledAt,
    ...note,
    currency,
    conversion,
    instrument: toInstrument(row),
    venue: venueRef(readColumn(row.venue, row)),
    amount: readAmount(row.amount, row),
  }
}

interface CashTxnFields {
  readonly row: LedgerRow
  readonly kind: 'deposit' | 'withdrawal' | 'fee' | 'loss'
  readonly at: ReturnType<typeof tradingDay>
  readonly settledAt: ReturnType<typeof tradingDay>
  readonly note: { readonly note?: string }
  readonly currency: ReturnType<typeof currencyCode>
  readonly conversion: FxConversion
}

function toCashTxn(fields: CashTxnFields): LedgerTxn {
  const { row, kind, at, settledAt, note, currency, conversion } = fields

  return {
    kind,
    at,
    settledAt,
    ...note,
    venue: venueRef(readColumn(row.venue, row)),
    currency,
    conversion,
    amount: readAmount(row.amount, row),
  }
}

function toTxnKind(raw: string): LedgerTxnKind {
  const kinds: readonly string[] = LEDGER_TXN_KINDS

  if (!kinds.includes(raw)) {
    throw new StorageError(`unknown ledger transaction kind: ${raw}`)
  }

  // why-safe: membership in the contract tuple is this brand's only invariant and it just passed.
  return raw as LedgerTxnKind
}

function toCloseReason(raw: string | null): CloseReason | undefined {
  return CLOSE_REASONS.find((reason) => reason === raw)
}

function toConversion(row: LedgerRow): FxConversion {
  const raw = readColumn(row.conversion, row)
  const parsed = parseJson(raw, 'ledger conversion', (value) => conversionSchema.parse(value))

  return {
    fromCurrency: currencyCode(parsed.fromCurrency),
    toCurrency: currencyCode(parsed.toCurrency),
    rate: readAmount(row.fx_rate, row),
    source: parsed.source,
    ...(parsed.sourceId === undefined ? {} : { sourceId: sourceId(parsed.sourceId) }),
    asOf: tradingDay(parsed.asOf),
    ...(parsed.fetchedAt === undefined ? {} : { fetchedAt: parsed.fetchedAt }),
  }
}

function toInstrument(row: LedgerRow): InstrumentRef {
  return {
    market: marketRef(readColumn(row.market, row)),
    ticker: brandTicker(readColumn(row.ticker, row)),
  }
}

function readAmount(value: number | null, row: LedgerRow): number {
  return requireColumn(value, `ledger entry ${row.id} is missing an amount for ${row.txn_kind}`)
}

function readColumn(value: string | null, row: LedgerRow): string {
  return requireColumn(
    value,
    `ledger entry ${row.id} is missing a required column for ${row.txn_kind}`
  )
}
