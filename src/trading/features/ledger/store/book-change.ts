import type { Transaction } from '@/core/types/storage'
import type { LedgerEntry } from '@/trading/features/ledger/types'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { BookChange } from '@/trading/kernel/operator/book'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'

/** The query's integer answer, by value. */
const BOOK_CHANGES: readonly BookChange[] = Object.freeze(['none', 'book', 'instrument'])

interface ChangeSinceQuery {
  readonly instrument: InstrumentRef
  readonly from: number
  readonly signal: AbortSignal
}

export async function bookChangeSince(
  deps: StoreDeps,
  options: ChangeSinceQuery
): Promise<BookChange> {
  const { instrument } = options

  assertNotAborted(options.signal)

  const p = deps.dialect.param
  // An unchanged book, the usual answer, costs one scan per table. A deleted row is gone, so its
  // trace is the `ledger_deletions` row. Integers rather than the boolean `EXISTS` gives Postgres,
  // so both engines answer alike.
  const rows = await deps.db.query<{ readonly change: number }>(
    `SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ledger_entries WHERE COALESCE(updated_at, recorded_at) > ${p(3)}) AND NOT EXISTS (SELECT 1 FROM ledger_deletions WHERE deleted_at > ${p(3)}) THEN 0 WHEN EXISTS (SELECT 1 FROM ledger_entries WHERE market = ${p(1)} AND ticker = ${p(2)} AND COALESCE(updated_at, recorded_at) > ${p(3)}) OR EXISTS (SELECT 1 FROM ledger_deletions WHERE market = ${p(1)} AND ticker = ${p(2)} AND deleted_at > ${p(3)}) THEN 2 ELSE 1 END AS change`,
    [instrument.market, instrument.ticker, options.from]
  )

  return BOOK_CHANGES[Number(rows[0]?.change ?? 0)] ?? 'none'
}

interface DeletionRecord {
  readonly removed: LedgerEntry
  readonly deletedAt: number
}

/** A cash row names no instrument, so it is kept under empty `market` and `ticker`: a book-wide
 *  change no instrument's own call is outdated by. */
export async function recordDeletion(
  deps: StoreDeps,
  tx: Transaction,
  record: DeletionRecord
): Promise<void> {
  const { transaction } = record.removed
  const instrument = 'instrument' in transaction ? transaction.instrument : undefined

  await tx.execute(
    `INSERT INTO ledger_deletions (market, ticker, deleted_at) VALUES (${deps.dialect.paramList(3)}) ON CONFLICT (market, ticker) DO UPDATE SET deleted_at = excluded.deleted_at`,
    [instrument?.market ?? '', instrument?.ticker ?? '', record.deletedAt]
  )
}
