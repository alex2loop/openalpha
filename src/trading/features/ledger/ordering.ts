import type { LedgerEntry, LedgerTxn } from '@/trading/features/ledger/types'
import type { LedgerEntryId } from '@/trading/kernel/operator/book'

/** Where a row stands in ledger order: its day, then its id. */
interface LedgerSlot {
  readonly id: LedgerEntryId
  readonly transaction: Pick<LedgerTxn, 'at'>
}

/** Chronological order, with entry id breaking ties within a day. Rows are editable, so an entry's
 *  day can move freely and the stored order is not the trading order — this is the one place that
 *  reconciles them, and every fold and replay goes through it. The id is a UUIDv7, so the tie-break
 *  is append order down to the millisecond and no finer; a batch minted from one clock read would
 *  need a real sequence. */
export function orderLedger(entries: readonly LedgerEntry[]): readonly LedgerEntry[] {
  return [...entries].sort(compareEntries)
}

/** The ledger in order up to where a row lands. An edit keeps its id, so it lands among the rows
 *  of its day where it was and never sees its own stored version; a new row has no id yet and lands
 *  after every row (the fold's day cut-off does the rest). */
export function orderLedgerBefore(
  entries: readonly LedgerEntry[],
  row: { readonly id: LedgerEntryId | undefined; readonly transaction: Pick<LedgerTxn, 'at'> }
): readonly LedgerEntry[] {
  const { id } = row

  if (id === undefined) {
    return orderLedger(entries)
  }

  const slot = { id, transaction: row.transaction }

  return orderLedger(entries).filter((entry) => entry.id !== id && isOrderedBefore(entry, slot))
}

export function isOrderedBefore(left: LedgerSlot, right: LedgerSlot): boolean {
  return compareEntries(left, right) < 0
}

function compareEntries(left: LedgerSlot, right: LedgerSlot): number {
  const byDay = left.transaction.at.localeCompare(right.transaction.at)

  return byDay === 0 ? left.id.localeCompare(right.id) : byDay
}
