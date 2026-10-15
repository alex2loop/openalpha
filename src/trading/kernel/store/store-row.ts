import type { Dialect, Storage } from '@/core/types/storage'
import type { Page } from '@/trading/kernel/store/page'
import { StorageError } from '@/core/errors'
import { bindChunkSize } from '@/persistence/api'

export interface StoreDeps {
  readonly db: Storage
  readonly dialect: Dialect
}

/** Fixed-size slices of a list. Private: `toBindChunks` is the only shape a caller needs, and the
 *  bind ceiling is what decides the size. */
function toChunks<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const step = Math.max(1, size)
  const chunks: (readonly T[])[] = []

  for (let index = 0; index < items.length; index += step) {
    chunks.push(items.slice(index, index + step))
  }

  return chunks
}

/** Splits records into statement-sized batches. The size is the bind ceiling's to decide. */
export function toBindChunks<T>(
  records: readonly T[],
  columnCount: number
): readonly (readonly T[])[] {
  return toChunks(records, bindChunkSize(columnCount))
}

/** One keyset page for every paged read. Fetching `limit + 1` is what distinguishes "this is the
 *  last page" from "there may be more" without a second COUNT query. */
export function toPage<T, TCursor>(
  rows: readonly T[],
  limit: number,
  cursorOf: (row: T) => TCursor
): Page<T, TCursor> {
  if (rows.length <= limit) {
    return { items: rows }
  }

  const items = rows.slice(0, limit)
  const last = items[items.length - 1]

  return last === undefined ? { items } : { items, nextCursor: cursorOf(last) }
}

/** A validating parse, not a blind cast: `parse` narrows `unknown` before the caller ever sees a
 *  `T`. Corrupt persisted JSON is a storage-boundary failure, not a domain validation failure. */
export function parseJson<T>(raw: string, label: string, parse: (value: unknown) => T): T {
  try {
    return parse(JSON.parse(raw))
  } catch (err: unknown) {
    throw new StorageError(`unreadable ${label} payload`, err)
  }
}

/** Unwrap a state-dependent nullable column. The message names the offending row so a violated
 *  CHECK constraint surfaces as which row broke, not as a bare null downstream. */
export function requireColumn<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new StorageError(message)
  }

  return value
}
