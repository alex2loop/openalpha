import type { BindingSpec, Database, SAHPoolUtil, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

import type { Logger } from '@/core/logging/logger'
import type { Storage, Transaction } from '@/core/types/storage'
import { StorageError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { toStorageError } from '@/persistence/errors'

export const DB_LOCK_NAME = 'openalpha-db'

const PRAGMAS = ['PRAGMA foreign_keys = ON', 'PRAGMA journal_mode = TRUNCATE'] as const
// Another tab's handles free a moment after its lock does (a stolen lock, a page still unloading),
// so the first install can lose that race by a few hundred milliseconds.
const INSTALL_ATTEMPTS = 25
const INSTALL_RETRY_MS = 200
// A failed install keeps the pool's files: the default would delete the pool, which is the whole
// database, because another tab still held a handle. The reinit flag lets the retry run again; the
// runtime reads it though the package types omit it, so it is declared outside the literal.
const INSTALL_OPTIONS = { preserveOnInitFailure: true, forceReinitIfPreviouslyFailed: true }

export interface SqliteWasmOptions {
  readonly name: string
  readonly wasmUrl: string
  readonly logger: Logger
  readonly steal: boolean
}

export type OpenSqliteWasmResult =
  | { readonly kind: 'opened'; readonly storage: Storage; readonly lost: Promise<void> }
  | { readonly kind: 'locked' }
  | { readonly kind: 'unsupported' }

interface LockHold {
  readonly release: () => void
  // Settles when another tab takes the lock away; never on our own release.
  readonly stolen: Promise<void>
}

interface Engine {
  readonly db: Database
  readonly pool: SAHPoolUtil
  readonly hold: LockHold
  readonly logger: Logger
}

// `init` is declared without a parameter list upstream on purpose; it still takes Emscripten's
// module options.
type InitSqlite = (module: {
  readonly locateFile: (file: string) => string
}) => Promise<Sqlite3Static>

export async function openSqliteWasm(options: SqliteWasmOptions): Promise<OpenSqliteWasmResult> {
  const locks = navigator.locks

  if (locks === undefined || !hasOpfsSyncHandles()) {
    return { kind: 'unsupported' }
  }

  const hold = await acquireLock(locks, options.steal)

  if (hold === null) {
    return { kind: 'locked' }
  }

  try {
    const { db, pool } = await openDatabase(options)
    const storage = createStorage({ db, pool, hold, logger: options.logger })
    const lost = hold.stolen.then(() => {
      options.logger.warn('sqlite_wasm.lock_lost', { name: options.name })

      return storage.close()
    })

    return { kind: 'opened', storage, lost }
  } catch (err: unknown) {
    hold.release()

    throw err
  }
}

function hasOpfsSyncHandles(): boolean {
  return (
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof FileSystemFileHandle !== 'undefined' &&
    'createSyncAccessHandle' in FileSystemFileHandle.prototype
  )
}

// The lock is held until `release`: the request's callback stays pending on it. A steal rejects
// the request, which is how the displaced tab learns it lost the database.
function acquireLock(locks: BrowserLockManager, steal: boolean): Promise<LockHold | null> {
  return new Promise((resolve, reject) => {
    const freed = Promise.withResolvers<void>()
    const stolen = Promise.withResolvers<void>()

    locks
      .request(DB_LOCK_NAME, { ifAvailable: !steal, steal }, async (lock) => {
        resolve(lock === null ? null : { release: freed.resolve, stolen: stolen.promise })

        if (lock !== null) {
          await freed.promise
        }
      })
      .catch((err: unknown) => {
        reject(toStorageError(err, 'database lock request failed'))
        stolen.resolve()
      })
  })
}

async function openDatabase(
  options: SqliteWasmOptions
): Promise<{ readonly db: Database; readonly pool: SAHPoolUtil }> {
  const sqlite3 = await loadSqlite(options.wasmUrl)
  const pool = await installPool(sqlite3)
  let db: Database | undefined

  try {
    // The VFS takes absolute paths only.
    db = new pool.OpfsSAHPoolDb(`/${options.name}`)

    for (const pragma of PRAGMAS) {
      db.exec(pragma)
    }

    return { db, pool }
  } catch (err: unknown) {
    closeQuietly(db)
    pool.pauseVfs()

    throw toStorageError(err, `sqlite wasm open failed: ${options.name}`)
  }
}

// Loaded here, not at the top: the daemon imports this file's barrel under Bun and has no use for
// the module.
async function loadSqlite(wasmUrl: string): Promise<Sqlite3Static> {
  const { default: init } = await import('@sqlite.org/sqlite-wasm')
  // why-safe: the declared signature omits the options argument; the module reads `locateFile`.
  const initWithOptions = init as unknown as InitSqlite

  return initWithOptions({ locateFile: () => wasmUrl })
}

async function installPool(sqlite3: Sqlite3Static): Promise<SAHPoolUtil> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await sqlite3.installOpfsSAHPoolVfs(INSTALL_OPTIONS)
    } catch (err: unknown) {
      if (attempt >= INSTALL_ATTEMPTS) {
        throw toStorageError(err, 'opfs storage could not be opened')
      }

      await new Promise((resolve) => setTimeout(resolve, INSTALL_RETRY_MS))
    }
  }
}

function closeQuietly(db: Database | undefined): void {
  try {
    db?.close()
  } catch {
    // The open failure already on its way to the caller is the one worth reporting.
  }
}

function createStorage(engine: Engine): Storage {
  const tx = createTransaction(engine.db)
  // One connection, and BEGIN IMMEDIATE is per-connection: a bare query/execute run while a
  // transaction is mid-flight would land inside it. Every op chains on this tail. The tail is
  // replaced, never appended.
  let txTail: Promise<unknown> = Promise.resolve()
  let closeTask: Promise<void> | null = null
  let closed = false

  // A failed ROLLBACK closes the handle; seal the surface to match and free what it held.
  const seal = (): void => {
    closed = true
    closeTask ??= Promise.resolve().then(() => freeEngine(engine))
  }

  const enqueue = <T>(op: () => Promise<T>, boundary: string): Promise<T> => {
    if (closed) {
      return Promise.reject(new StorageError('storage is closed'))
    }

    const next = txTail.then(op)
    txTail = next.catch(() => undefined)

    return next.catch((err: unknown) => Promise.reject(toStorageError(err, boundary)))
  }

  return {
    query<T>(sql: string, params?: readonly unknown[]) {
      return enqueue(() => tx.query<T>(sql, params), 'sqlite query failed')
    },
    execute(sql: string, params?: readonly unknown[]) {
      return enqueue(() => tx.execute(sql, params), 'sqlite execute failed')
    },
    transaction(fn) {
      return enqueue(() => runTransaction(engine, fn, seal), 'sqlite transaction failed')
    },
    // Idempotent and non-throwing: every caller awaits the one close.
    close(): Promise<void> {
      closed = true
      closeTask ??= txTail.then(() => freeEngine(engine))

      return closeTask
    },
  }
}

// Handles first, lock last: the next holder must find the files free the moment it is granted.
function freeEngine(engine: Engine): void {
  try {
    engine.db.close()
  } catch (err: unknown) {
    engine.logger.error('sqlite_wasm.close_failed', { err: formatErrForLog(err) })
  }

  try {
    engine.pool.pauseVfs()
  } catch (err: unknown) {
    engine.logger.error('sqlite_wasm.vfs_pause_failed', { err: formatErrForLog(err) })
  }

  engine.hold.release()
}

async function runTransaction<T>(
  engine: Engine,
  fn: (tx: Transaction) => Promise<T>,
  seal: () => void
): Promise<T> {
  const { db } = engine

  try {
    db.exec('BEGIN IMMEDIATE')
  } catch (err: unknown) {
    throw toStorageError(err, 'sqlite begin failed')
  }

  try {
    const result = await fn(createTransaction(db))
    db.exec('COMMIT')

    return result
  } catch (err: unknown) {
    rollback(engine, seal)

    throw toStorageError(err, 'sqlite transaction failed')
  }
}

function rollback(engine: Engine, seal: () => void): void {
  try {
    engine.db.exec('ROLLBACK')
  } catch (err: unknown) {
    // Stuck inside BEGIN IMMEDIATE the connection would block every later writer: close it so the
    // failure is loud.
    engine.logger.error('sqlite_wasm.rollback_failed', { err: formatErrForLog(err) })
    closeQuietly(engine.db)
    seal()
  }
}

function createTransaction(db: Database): Transaction {
  return {
    query: async <T>(sql: string, params: readonly unknown[] = []) =>
      // why-safe: `T` is the caller's claim about its own SQL; sqlite returns untyped rows either way.
      db.exec({
        sql,
        rowMode: 'object',
        returnValue: 'resultRows',
        ...bindingOf(params),
      }) as unknown as T[],
    execute: async (sql: string, params: readonly unknown[] = []) => {
      db.exec({ sql, ...bindingOf(params) })

      return { changes: db.changes() }
    },
  }
}

// An empty binding is left out so a multi-statement script (DDL) runs as one.
function bindingOf(params: readonly unknown[]): { readonly bind?: BindingSpec } {
  // why-safe: the Storage contract carries `unknown` params by design; sqlite rejects at runtime
  // any value it cannot bind.
  return params.length === 0 ? {} : { bind: params as BindingSpec }
}
