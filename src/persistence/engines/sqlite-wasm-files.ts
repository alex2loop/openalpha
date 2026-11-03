import type { Database, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

import type { Logger } from '@/core/logging/logger'
import type { Storage } from '@/core/types/storage'
import { StorageError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { createTransaction } from '@/persistence/engines/sqlite-wasm-sql'
import { toStorageError } from '@/persistence/errors'

/** The working database as a file: what leaves the tab and what a file the visitor picked is
 *  checked and swapped in with. Every call waits its turn behind the storage's own statements, so
 *  none lands inside a transaction. */
export interface DatabaseFiles {
  /** Every committed page as one SQLite file. */
  exportBytes(): Promise<Uint8Array>
  /** A read-only in-memory copy of `bytes` to look inside before anything is replaced. The caller
   *  closes it. Throws when the bytes do not open as a database. */
  openScratch(bytes: Uint8Array): Storage
  /** Swaps `bytes` in for the working database. When anything fails the previous content is put
   *  back and the error is thrown, so the working database is never half replaced. */
  replaceWith(bytes: Uint8Array): Promise<void>
}

/** What the files need of the engine: the live connection (replaced by a swap) and the pool that
 *  owns the file. */
interface FileEngine {
  db: Database
  readonly pool: SAHPoolUtil
  readonly sqlite3: Sqlite3Static
}

interface FilesOptions {
  readonly engine: FileEngine
  /** The VFS path of the working database. */
  readonly path: string
  readonly reopen: () => Database
  readonly run: <T>(operation: () => Promise<T>) => Promise<T>
  readonly logger: Logger
}

export function createDatabaseFiles(options: FilesOptions): DatabaseFiles {
  const { engine, run } = options

  return {
    exportBytes: () => run(async () => serialize(engine)),
    openScratch: (bytes) => openScratch(engine.sqlite3, bytes),
    replaceWith: (bytes) => run(() => swap(options, bytes)),
  }
}

function serialize(engine: FileEngine): Uint8Array {
  try {
    return engine.sqlite3.capi.sqlite3_js_db_export(engine.db)
  } catch (err: unknown) {
    throw toStorageError(err, 'sqlite export failed')
  }
}

// The old content is held in memory while the file is overwritten in place, because the pool has
// no rename: a failed write or reopen puts it back.
async function swap(options: FilesOptions, bytes: Uint8Array): Promise<void> {
  const { engine, path } = options
  const previous = serialize(engine)

  engine.db.close()

  try {
    await engine.pool.importDb(path, bytes)
    engine.db = options.reopen()
  } catch (err: unknown) {
    await putBack(options, previous)

    throw toStorageError(err, 'sqlite database replace failed')
  }
}

async function putBack(options: FilesOptions, previous: Uint8Array): Promise<void> {
  try {
    await options.engine.pool.importDb(options.path, previous)
    options.engine.db = options.reopen()
  } catch (err: unknown) {
    options.logger.error('sqlite_wasm.restore_failed', { err: formatErrForLog(err) })
  }
}

function openScratch(sqlite3: Sqlite3Static, bytes: Uint8Array): Storage {
  const { capi, wasm, oo1 } = sqlite3
  const db = new oo1.DB(':memory:')

  try {
    // Freed by sqlite when the database closes, or at once when the load fails.
    const code = capi.sqlite3_deserialize(
      db.pointer ?? 0,
      'main',
      wasm.allocFromTypedArray(bytes),
      bytes.byteLength,
      bytes.byteLength,
      capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_READONLY
    )

    db.checkRc(code)
  } catch (err: unknown) {
    db.close()

    throw new StorageError('sqlite scratch open failed', err)
  }

  const tx = createTransaction(() => db)

  return {
    query: tx.query,
    execute: tx.execute,
    transaction: (fn) => fn(tx),
    close: async () => db.close(),
  }
}
