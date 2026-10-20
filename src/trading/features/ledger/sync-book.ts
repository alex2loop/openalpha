import type { Logger } from '@/core/logging/logger'
import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type { SkippedFill, SyncedFill } from '@/trading/features/ledger/sync'
import type {
  FillSource,
  LedgerEntry,
  LedgerTxnDraftInput,
  LedgerWriteResult,
} from '@/trading/features/ledger/types'
import type { Book } from '@/trading/kernel/operator/book'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { buildInstrumentKey } from '@/trading/kernel/instrument'

const VOID_TIMEOUT_MS = 30_000

/** The two portfolio writes a sync makes, declared here because `ledger` does not import
 *  `portfolio`. `PortfolioService` satisfies it. */
interface FillWriter {
  record(options: {
    readonly draft: LedgerTxnDraftInput
    readonly idempotencyKey: string
    readonly fillSource: FillSource
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<LedgerWriteResult>
  remove(options: {
    readonly ref: string
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<LedgerWriteResult>
}

interface SyncBookDeps {
  readonly portfolio: FillWriter
  readonly ledger: Pick<LedgerStore, 'findByIdempotency'>
  readonly logger: Logger
}

/** What one pass over the fills left behind: the rows it wrote, the fills it could not write, and
 *  the instruments at least one fill of which was refused. */
interface BookedFills {
  readonly entries: readonly LedgerEntry[]
  readonly skipped: readonly SkippedFill[]
  readonly partial: ReadonlySet<string>
  /** The book the last write left, which says what each currency the sync touched was paid from. */
  book?: Book
}

/** A venue's fills booked oldest first, less every name the book could take only part of. */
export async function bookVenueFills(
  deps: SyncBookDeps,
  fills: readonly SyncedFill[],
  signal: AbortSignal
): Promise<Omit<BookedFills, 'partial'>> {
  const booked = await bookFills(deps, fills, signal)

  return await voidPartialInstruments(deps, signal, booked)
}

/** Oldest first across every instrument, because the write order is the economic one: a buy has to
 *  land before the sale that closes it, and before a purchase elsewhere spends the cash it needs. */
async function bookFills(
  deps: SyncBookDeps,
  fills: readonly SyncedFill[],
  signal: AbortSignal
): Promise<BookedFills> {
  const entries: LedgerEntry[] = []
  const skipped: SkippedFill[] = []
  const partial = new Set<string>()
  const booked: BookedFills = { entries, skipped, partial }

  for (const [index, fill] of fills.entries()) {
    try {
      const write = await recordFill(deps, fill, signal)

      if (write === undefined) {
        partial.add(buildInstrumentKey(fill.draft.instrument))
        skipped.push({ symbol: fill.symbol, reason: 'refused' })
        continue
      }

      // Already booked under this key (the order mirror): not this pass's row to report or void.
      if (write.replayed === true) {
        continue
      }

      entries.push(write.entry)
      booked.book = write.book
    } catch (err: unknown) {
      await voidAfterFailure(deps, booked, fills.slice(index))

      throw err
    }
  }

  return booked
}

/** A throw mid-pass (a cancel included) leaves every name it had not finished half booked, the fill
 *  in flight too: it may have landed before the throw, so it is looked up by its key. Best effort
 *  under its own bound, because a cancel has spent the caller's signal; what it cannot void is
 *  logged and the original error still stands. */
async function voidAfterFailure(
  deps: SyncBookDeps,
  booked: BookedFills,
  pending: readonly SyncedFill[]
): Promise<void> {
  const signal = AbortSignal.timeout(VOID_TIMEOUT_MS)

  try {
    const inFlight = pending[0]
    const landed =
      inFlight === undefined
        ? null
        : await deps.ledger.findByIdempotency({ idempotencyKey: inFlight.idempotencyKey, signal })

    const entries = landed === null ? booked.entries : [...booked.entries, landed.entry]
    const partial = new Set(booked.partial)

    for (const fill of pending) {
      partial.add(buildInstrumentKey(fill.draft.instrument))
    }

    await voidPartialInstruments(deps, signal, { entries, skipped: booked.skipped, partial })
  } catch (err: unknown) {
    deps.logger.warn('ledger.sync_cleanup_failed', { err: formatErrForLog(err) })
  }
}

/** A name the book could take only part of is taken not at all. Six of a name's thirty fills state
 *  a position that never existed and a cost basis nothing later can correct, and every reading taken
 *  from it — the sizing, the record, the exit plan — is wrong in a way no surface can show. Removed
 *  newest first, so the book passes through no state it would have refused on the way in. */
async function voidPartialInstruments(
  deps: SyncBookDeps,
  signal: AbortSignal,
  booked: BookedFills
): Promise<Omit<BookedFills, 'partial'>> {
  const { entries, skipped, book } = booked

  if (booked.partial.size === 0) {
    return { entries, skipped, ...(book === undefined ? {} : { book }) }
  }

  const now = Date.now()
  const kept: LedgerEntry[] = []
  const voided: SkippedFill[] = []
  let latest = book

  for (const entry of [...booked.entries].reverse()) {
    const instrument = 'instrument' in entry.transaction ? entry.transaction.instrument : undefined

    if (instrument === undefined || !booked.partial.has(buildInstrumentKey(instrument))) {
      kept.push(entry)
      continue
    }

    const after = await voidEntry(deps, { entry, now, signal })

    if (after !== undefined) {
      voided.push({ symbol: instrument.ticker, reason: 'partial' })
      latest = after
      continue
    }

    kept.push(entry)
  }

  return {
    entries: kept.reverse(),
    skipped: [...skipped, ...voided],
    ...(latest === undefined ? {} : { book: latest }),
  }
}

/** The book the removal left. Removing a row re-folds the book, and a sale's proceeds leaving can
 *  put a later purchase short of cash, so this can refuse and return nothing. The row then stays,
 *  is reported as recorded, and its name is still reported partial — which is the honest pair,
 *  since both are true of the book as it now stands. */
async function voidEntry(
  deps: SyncBookDeps,
  removal: { readonly entry: LedgerEntry; readonly now: number; readonly signal: AbortSignal }
): Promise<Book | undefined> {
  try {
    const removed = await deps.portfolio.remove({
      ref: removal.entry.id,
      now: removal.now,
      signal: removal.signal,
    })

    return removed.book
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('ledger.sync_void_failed', {
      entryId: removal.entry.id,
      err: formatErrForLog(err),
    })

    return undefined
  }
}

/** One fill at a time, because the book is folded and validated per row. A refusal stops that row
 *  and no other here; what it costs the rest of its instrument is decided afterwards, once the pass
 *  has seen every fill that name had. */
async function recordFill(
  deps: SyncBookDeps,
  fill: SyncedFill,
  signal: AbortSignal
): Promise<LedgerWriteResult | undefined> {
  try {
    return await deps.portfolio.record({
      draft: fill.draft,
      idempotencyKey: fill.idempotencyKey,
      // The figures are already the venue's own, which both records the provenance and stops the
      // write path from asking it for a fill this command just read.
      fillSource: 'venue',
      now: Date.now(),
      signal,
    })
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('ledger.sync_fill_refused', {
      venue: fill.draft.venue,
      ticker: fill.draft.instrument.ticker,
      at: fill.draft.at,
      err: formatErrForLog(err),
    })

    return undefined
  }
}
