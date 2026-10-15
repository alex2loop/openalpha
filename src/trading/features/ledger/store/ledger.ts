import type { Transaction } from '@/core/types/storage'
import type { LedgerRow } from '@/trading/features/ledger/store/ledger-row'
import type {
  LedgerEntry,
  LedgerInsert,
  LedgerPageOptions,
  LedgerTxn,
} from '@/trading/features/ledger/types'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { LedgerEntryId } from '@/trading/kernel/operator/book'
import type { Page } from '@/trading/kernel/store/page'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted, ConflictError, ValidationError } from '@/core/errors'
import {
  IDENTITY_COLUMNS,
  TRANSACTION_COLUMNS,
  toEntry,
  transactionColumns,
} from '@/trading/features/ledger/store/ledger-row'
import { ledgerEntryId } from '@/trading/kernel/operator/book'
import { toPage } from '@/trading/kernel/store/store-row'

const INSERT_COLUMNS = [...IDENTITY_COLUMNS, ...TRANSACTION_COLUMNS]
const INSERT_SQL = `INSERT INTO ledger_entries (${INSERT_COLUMNS.join(', ')}) VALUES `

/** The whole ledger is one operator's book, so the serializing lock is table-wide. */
const LEDGER_LOCK_NAME = 'ledger_entries'

interface FindByIdempotencyOptions {
  readonly idempotencyKey: string
  readonly signal: AbortSignal
}

/** The pure validator the caller supplies. It receives the whole ledger as it will stand once the
 *  write lands and throws when that book is inconsistent — an edit can invalidate a row it never
 *  touched, so nothing less than the full set is enough to check. */
export type AssertLedgerValid = (pending: readonly LedgerEntry[]) => void

/** The receipt plus the fingerprint that produced it, so a caller can tell a genuine replay from a
 *  key reused with different content before doing any provider work. */
interface StoredLedgerRequest {
  readonly entry: LedgerEntry
  readonly requestFingerprint: string
}

type LedgerInsertResult =
  | {
      readonly kind: 'inserted'
      readonly entry: LedgerEntry
      /** A row already holding this request's exact content. The write still lands - trading the
       *  same size twice in a day is a thing that happens - but the confirmation says so. */
      readonly duplicateOf?: LedgerEntryId
    }
  | { readonly kind: 'existing'; readonly entry: LedgerEntry }

/** An edit names the row and the transaction that replaces it. `recordedAt` is not here: it says
 *  when the row first appeared and no edit may rewrite it. */
interface LedgerPatch {
  readonly id: LedgerEntryId
  readonly transaction: LedgerTxn
  readonly updatedAt: number
}

export interface LedgerStore {
  findByIdempotency(options: FindByIdempotencyOptions): Promise<StoredLedgerRequest | null>
  insertValidated(
    insert: LedgerInsert,
    assertValid: AssertLedgerValid,
    signal: AbortSignal
  ): Promise<LedgerInsertResult>
  /** Replaces one row's transaction wholesale; the id, its idempotency key, and `recordedAt` stay. */
  updateValidated(
    patch: LedgerPatch,
    assertValid: AssertLedgerValid,
    signal: AbortSignal
  ): Promise<LedgerEntry>
  deleteValidated(
    id: LedgerEntryId,
    assertValid: AssertLedgerValid,
    signal: AbortSignal
  ): Promise<LedgerEntry>
  /** The whole bounded ledger, for folding only — surfaces page instead. */
  listAll(signal: AbortSignal): Promise<readonly LedgerEntry[]>
  /** Whether any row for this instrument was written or corrected after `since`. A deletion leaves
   *  nothing to find, so this answers no for one. */
  hasTradedSince(instrument: InstrumentRef, since: number, signal: AbortSignal): Promise<boolean>
  /** Every id a full id or a short handle could name. More than one is an ambiguous handle, which
   *  the caller refuses rather than guessing between. */
  listIdsMatching(ref: string, signal: AbortSignal): Promise<readonly LedgerEntryId[]>
  listPage(options: LedgerPageOptions): Promise<Page<LedgerEntry, LedgerEntryId>>
}

/** Each write takes the same three inputs beyond `deps`: what to write, the validator to run over
 *  the resulting book, and the caller's signal. */
interface WriteOptions<T> {
  readonly subject: T
  readonly assertValid: AssertLedgerValid
  readonly signal: AbortSignal
}

interface LedgerStoreDeps extends StoreDeps {
  readonly maximumEntries: number
}

export function createLedgerStore(deps: LedgerStoreDeps): LedgerStore {
  return {
    findByIdempotency: (options) => findByIdempotency(deps, options),
    insertValidated: (insert, assertValid, signal) =>
      insertValidated(deps, { subject: insert, assertValid, signal }),
    updateValidated: (patch, assertValid, signal) =>
      updateValidated(deps, { subject: patch, assertValid, signal }),
    deleteValidated: (id, assertValid, signal) =>
      deleteValidated(deps, { subject: id, assertValid, signal }),
    listAll: (signal) => listAll(deps, signal),
    hasTradedSince: (instrument, since, signal) =>
      hasTradedSince(deps, { instrument, since, signal }),
    listIdsMatching: (ref, signal) => listIdsMatching(deps, ref, signal),
    listPage: (options) => listPage(deps, options),
  }
}

async function findByIdempotency(
  deps: LedgerStoreDeps,
  options: FindByIdempotencyOptions
): Promise<StoredLedgerRequest | null> {
  assertNotAborted(options.signal)

  const rows = await deps.db.query<LedgerRow>(
    `SELECT * FROM ledger_entries WHERE idempotency_key = ${deps.dialect.param(1)}`,
    [options.idempotencyKey]
  )
  const row = rows[0]

  return row ? { entry: toEntry(row), requestFingerprint: row.request_fingerprint } : null
}

interface TradedSinceQuery {
  readonly instrument: InstrumentRef
  readonly since: number
  readonly signal: AbortSignal
}

async function hasTradedSince(deps: LedgerStoreDeps, options: TradedSinceQuery): Promise<boolean> {
  const { instrument } = options

  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<Pick<LedgerRow, 'id'>>(
    `SELECT id FROM ledger_entries WHERE market = ${p(1)} AND ticker = ${p(2)} AND COALESCE(updated_at, recorded_at) > ${p(3)} LIMIT 1`,
    [instrument.market, instrument.ticker, options.since]
  )

  return rows.length > 0
}

async function insertValidated(
  deps: LedgerStoreDeps,
  options: WriteOptions<LedgerInsert>
): Promise<LedgerInsertResult> {
  const { subject: insert, assertValid, signal } = options

  assertNotAborted(signal)

  return deps.db.transaction(async (tx) => {
    assertNotAborted(signal)
    await lockLedger(deps, tx)

    const existing = await findInTransaction(deps, tx, insert.idempotencyKey)

    if (existing) {
      if (existing.requestFingerprint !== insert.requestFingerprint) {
        throw new ConflictError('idempotency key reused with a different request')
      }

      return { kind: 'existing', entry: existing.entry }
    }

    const current = await queryEntries(tx)

    if (current.length >= deps.maximumEntries) {
      throw new ValidationError('ledger entry limit reached')
    }

    const duplicateOf = await findFingerprintMatch(deps, tx, insert.requestFingerprint)

    assertValid([...current, insert.entry])
    await insertEntry(deps, tx, insert)

    return {
      kind: 'inserted',
      entry: insert.entry,
      ...(duplicateOf === null ? {} : { duplicateOf }),
    }
  })
}

async function updateValidated(
  deps: LedgerStoreDeps,
  options: WriteOptions<LedgerPatch>
): Promise<LedgerEntry> {
  const { subject: patch, assertValid, signal } = options

  assertNotAborted(signal)

  return deps.db.transaction(async (tx) => {
    assertNotAborted(signal)
    await lockLedger(deps, tx)

    const current = await queryEntries(tx)
    const existing = assertKnownEntry(current, patch.id)
    const next: LedgerEntry = {
      ...existing,
      updatedAt: patch.updatedAt,
      transaction: patch.transaction,
    }

    assertValid(current.map((row) => (row.id === next.id ? next : row)))
    await updateEntry(deps, tx, next)

    return next
  })
}

async function deleteValidated(
  deps: LedgerStoreDeps,
  options: WriteOptions<LedgerEntryId>
): Promise<LedgerEntry> {
  const { subject: id, assertValid, signal } = options

  assertNotAborted(signal)

  return deps.db.transaction(async (tx) => {
    assertNotAborted(signal)
    await lockLedger(deps, tx)

    const current = await queryEntries(tx)
    const removed = assertKnownEntry(current, id)

    assertValid(current.filter((row) => row.id !== id))
    await tx.execute(`DELETE FROM ledger_entries WHERE id = ${deps.dialect.param(1)}`, [id])

    return removed
  })
}

function assertKnownEntry(current: readonly LedgerEntry[], id: LedgerEntryId): LedgerEntry {
  const found = current.find((row) => row.id === id)

  if (found === undefined) {
    throw new ValidationError(`no ledger entry ${id}`)
  }

  return found
}

/** Postgres READ COMMITTED would let two concurrent writers each validate against a book the other
 *  is about to change; the advisory lock serializes them. sqlite is single-writer. */
async function lockLedger(deps: LedgerStoreDeps, tx: Transaction): Promise<void> {
  if (deps.dialect.name === 'postgres') {
    await tx.execute(`SELECT pg_advisory_xact_lock(hashtext(${deps.dialect.param(1)}))`, [
      LEDGER_LOCK_NAME,
    ])
  }
}

async function findInTransaction(
  deps: LedgerStoreDeps,
  tx: Transaction,
  idempotencyKey: string
): Promise<StoredLedgerRequest | null> {
  const rows = await tx.query<LedgerRow>(
    `SELECT * FROM ledger_entries WHERE idempotency_key = ${deps.dialect.param(1)}`,
    [idempotencyKey]
  )
  const row = rows[0]

  return row ? { entry: toEntry(row), requestFingerprint: row.request_fingerprint } : null
}

/** The fingerprint covers the day, the kind and every economic field, so a match is the same row
 *  written twice. Read inside the write lock, where it sees exactly the book the insert commits
 *  against, and ordered by id so the earliest of several is the one named.
 *
 *  Edited rows are excluded: the fingerprint records the request that created the row and no edit
 *  rewrites it, so against an edited row it describes content the row no longer holds. Missing a
 *  duplicate is a silence; naming one that is not there sends the operator to delete a good row.
 *
 *  Unindexed by design - the table is capped at `maximumEntries`, and an index carried for one
 *  lookup per write costs more than the scan it saves. */
async function findFingerprintMatch(
  deps: LedgerStoreDeps,
  tx: Transaction,
  requestFingerprint: string
): Promise<LedgerEntryId | null> {
  const rows = await tx.query<Pick<LedgerRow, 'id'>>(
    `SELECT id FROM ledger_entries WHERE request_fingerprint = ${deps.dialect.param(1)} ` +
      'AND updated_at IS NULL ORDER BY id LIMIT 1',
    [requestFingerprint]
  )
  const row = rows[0]

  return row ? ledgerEntryId(row.id) : null
}

async function insertEntry(
  deps: LedgerStoreDeps,
  tx: Transaction,
  insert: LedgerInsert
): Promise<void> {
  const { entry } = insert

  await tx.execute(`${INSERT_SQL}(${deps.dialect.paramList(INSERT_COLUMNS.length)})`, [
    entry.id,
    entry.recordedAt,
    entry.updatedAt ?? null,
    insert.idempotencyKey,
    insert.requestFingerprint,
    ...transactionColumns(entry.transaction),
  ])
}

async function updateEntry(
  deps: LedgerStoreDeps,
  tx: Transaction,
  entry: LedgerEntry
): Promise<void> {
  const columns = ['updated_at', ...TRANSACTION_COLUMNS]
  const assignments = columns.map((column, index) => `${column} = ${deps.dialect.param(index + 1)}`)

  await tx.execute(
    `UPDATE ledger_entries SET ${assignments.join(', ')} ` +
      `WHERE id = ${deps.dialect.param(columns.length + 1)}`,
    [entry.updatedAt ?? null, ...transactionColumns(entry.transaction), entry.id]
  )
}

async function queryEntries(tx: Transaction): Promise<readonly LedgerEntry[]> {
  const rows = await tx.query<LedgerRow>('SELECT * FROM ledger_entries', [])

  return rows.map(toEntry)
}

async function listAll(
  deps: LedgerStoreDeps,
  signal: AbortSignal
): Promise<readonly LedgerEntry[]> {
  assertNotAborted(signal)

  const rows = await deps.db.query<LedgerRow>('SELECT * FROM ledger_entries', [])

  return rows.map(toEntry)
}

/** A suffix match, not a scan in memory: the write path already reads the whole table once inside
 *  its transaction to validate, and reading it a second time to find one row is the fetch-all the
 *  store exists to avoid. `LIKE` cannot use an index here, but the ledger is bounded by
 *  `maximumEntries` and the database does the filtering. */
async function listIdsMatching(
  deps: LedgerStoreDeps,
  ref: string,
  signal: AbortSignal
): Promise<readonly LedgerEntryId[]> {
  assertNotAborted(signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<{ readonly id: string }>(
    `SELECT id FROM ledger_entries WHERE id = ${p(1)} OR id LIKE ${p(2)}`,
    [ref, `%${ref}`]
  )

  return rows.map((row) => ledgerEntryId(row.id))
}

/** Newest trading day first, insertion order within a day. The cursor is the last row's id; its
 *  `(at, id)` pair is read inside the statement so the page contract stays a single key. */
async function listPage(
  deps: LedgerStoreDeps,
  options: LedgerPageOptions
): Promise<Page<LedgerEntry, LedgerEntryId>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const filter = buildPageFilter(p, options)
  const params = [...filter.params, options.limit + 1]

  const rows = await deps.db.query<LedgerRow>(
    `SELECT * FROM ledger_entries ${filter.where}ORDER BY at DESC, id DESC LIMIT ${p(params.length)}`,
    params
  )

  return toPage(rows.map(toEntry), options.limit, (entry) => entry.id)
}

/** Day bounds compare as text, which is day order because `at` is an ISO day. */
function buildPageFilter(
  p: LedgerStoreDeps['dialect']['param'],
  options: LedgerPageOptions
): { readonly where: string; readonly params: readonly unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  const { fromDay, toDay } = options.range ?? {}

  if (fromDay !== undefined) {
    params.push(fromDay)
    conditions.push(`at >= ${p(params.length)}`)
  }

  if (toDay !== undefined) {
    params.push(toDay)
    conditions.push(`at <= ${p(params.length)}`)
  }

  if (options.instrument !== undefined) {
    params.push(options.instrument.market, options.instrument.ticker)
    conditions.push(`market = ${p(params.length - 1)} AND ticker = ${p(params.length)}`)
  }

  if (options.cursor) {
    params.push(options.cursor)
    conditions.push(`(at, id) < (SELECT at, id FROM ledger_entries WHERE id = ${p(params.length)})`)
  }

  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')} `

  return { where, params }
}
