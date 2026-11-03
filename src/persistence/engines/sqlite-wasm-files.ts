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
  /** Swaps `bytes` in for the working database and answers the content it replaced. When anything
   *  fails the previous content is put back and the error is thrown, so the working database is
   *  never half replaced. When the previous content cannot be put back either, the storage is
   *  sealed: every later request is refused rather than served by a closed connection. */
  replaceWith(bytes: Uint8Array): Promise<Uint8Array>
}

/** What the files need of the engine: the live connection (replaced by a swap) and the pool that
 *  owns the file. */
interface FileEngine {
  db: Database
  readonly pool: SAHPoolUtil
  readonly sqlite3: Sqlite3Static
  readonly logger: Logger
}

interface FilesOptions {
  readonly engine: FileEngine
  /** The VFS path of the working database. */
  readonly path: string
  readonly reopen: () => Database
  /** Refuses every later request and frees the engine. */
  readonly seal: () => void
  readonly run: <T>(operation: () => Promise<T>) => Promise<T>
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
// no rename: a failed write or reopen puts it back. A connection that cannot be closed, or old
// content that cannot be put back, leaves a closed or unknown handle: the storage is sealed.
async function swap(options: FilesOptions, bytes: Uint8Array): Promise<Uint8Array> {
  const { engine, path } = options
  const previous = serialize(engine)

  try {
    engine.db.close()
  } catch (err: unknown) {
    options.seal()

    throw toStorageError(err, 'sqlite database close failed')
  }

  try {
    await engine.pool.importDb(path, bytes)
    engine.db = options.reopen()

    return previous
  } catch (err: unknown) {
    if (!(await putBack(options, previous))) {
      options.seal()
    }

    throw toStorageError(err, 'sqlite database replace failed')
  }
}

async function putBack(options: FilesOptions, previous: Uint8Array): Promise<boolean> {
  try {
    await options.engine.pool.importDb(options.path, previous)
    options.engine.db = options.reopen()

    return true
  } catch (err: unknown) {
    options.engine.logger.error('sqlite_wasm.restore_failed', { err: formatErrForLog(err) })

    return false
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
