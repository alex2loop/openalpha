import { AppError, StorageError } from '@/core/errors'

// Storage→Caller boundary (spec Pillar A). A typed AppError from the caller's own transaction
// callback passes through untouched; anything else becomes a StorageError.
export function toStorageError(err: unknown, message: string): Error {
  return err instanceof AppError ? err : new StorageError(message, err)
}
