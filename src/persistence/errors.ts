import { AppError, StorageError } from '@/core/errors'

const SQLITE_FULL = 13
const SQLITE_IOERR = 10
const QUOTA_EXCEEDED = 'QuotaExceededError'
const CAUSE_DEPTH = 3

/** The disk or the browser's storage quota has no room left: a caller stops writing and tells
 *  the operator instead of retrying. */
export class StorageFullError extends StorageError {
  override readonly code = 'storage-full' as const
}

// Storage→Caller boundary (spec Pillar A). A typed AppError from the caller's own transaction
// callback passes through untouched; anything else becomes a StorageError, and a full disk or
// browser quota its own subclass so a surface can say so.
export function toStorageError(err: unknown, message: string): Error {
  if (err instanceof AppError) {
    return err
  }

  return isStorageFull(err) ? new StorageFullError(message, err) : new StorageError(message, err)
}

// Bun's driver names the result in `code`, sqlite-wasm in `resultCode`, and the browser throws a
// DOMException named for the quota; the failing write may sit a few causes down. The OPFS VFS
// catches that DOMException, logs it to the console and returns SQLITE_IOERR, so sqlite-wasm
// reports a full quota as a bare `resultCode` 10 with no cause: only sqlite-wasm sets `resultCode`,
// so the daemon's driver never reads an I/O error as a full disk.
function isStorageFull(err: unknown, depth = 0): boolean {
  if (!(err instanceof Error) || depth >= CAUSE_DEPTH) {
    return false
  }

  const code = 'code' in err ? err.code : undefined
  const resultCode = 'resultCode' in err ? err.resultCode : undefined

  return (
    err.name === QUOTA_EXCEEDED ||
    code === 'SQLITE_FULL' ||
    resultCode === SQLITE_FULL ||
    resultCode === SQLITE_IOERR ||
    isStorageFull(err.cause, depth + 1)
  )
}

/** A database a newer release migrated is one this binary cannot reason about: an older release
 *  reading it misreads rows (a revoked chat read as approved), so it stops before touching it.
 *  Names no path: where a restorable copy sits is the host's to say. */
export class SchemaAheadError extends AppError {
  readonly code = 'dbSchemaAhead' as const

  constructor(readonly orphans: readonly string[]) {
    super(`database schema is ahead of this release: ${orphans.join(', ')}`)
  }
}
