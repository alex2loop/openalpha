import { AppError, StorageError } from '@/core/errors'

// Storage→Caller boundary (spec Pillar A). A typed AppError from the caller's own transaction
// callback passes through untouched; anything else becomes a StorageError.
export function toStorageError(err: unknown, message: string): Error {
  return err instanceof AppError ? err : new StorageError(message, err)
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
