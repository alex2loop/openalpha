import { Database, type SQLQueryBindings } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { chmod, copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Logger } from '@/core/logging/logger'
import type { Dialect, Storage, Transaction } from '@/core/types/storage'
import { StorageError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from '@/core/security/private-files'
import { toStorageError } from '@/persistence/errors'
import { migrate } from '@/persistence/migrations/runner'
import { buildInsert, buildUpsert, paramList } from '@/persistence/sql/syntax'

const IN_MEMORY_PATH = ':memory:'
const SQLITE_DELETE_JOURNAL_MODE = 'PRAGMA journal_mode = DELETE'
const SQLITE_WAL_CHECKPOINT = 'PRAGMA wal_checkpoint(TRUNCATE)'
const SQLITE_IMMUTABLE_QUERY = '?immutable=1'
const STAGED_SUFFIX = '.staged'
const TEMPORARY_SUFFIX = '.tmp'
const SIDECAR_SUFFIXES = ['-wal', '-shm'] as const
const SQLITE_CACHE_SIZE_KIB = 4000
const SQLITE_MMAP_SIZE = 8 * 1024 * 1024
const SQLITE_BUSY_TIMEOUT_MS = 5000

// busy_timeout leads: switching to WAL takes a lock, and a second process holding the file would
// fail that statement at once if the wait were not yet set.
const PRAGMAS = [
  `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`,
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA temp_store = MEMORY',
  `PRAGMA cache_size = -${SQLITE_CACHE_SIZE_KIB}`,
  `PRAGMA mmap_size = ${SQLITE_MMAP_SIZE}`,
  'PRAGMA foreign_keys = ON',
] as const

function sqliteParam(index: number): string {
  return `?${index}`
}

export const sqliteDialect: Dialect = {
  name: 'sqlite',
  autoIncrementPk: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  param: sqliteParam,
  paramList: (count, startAt) => paramList(sqliteParam, count, startAt),
  upsert: (table, target) => buildUpsert(sqliteParam, table, target),
  insert: (table, target) => buildInsert(sqliteParam, table, target),
}

interface RestoreSqliteOptions {
  readonly dbPath: string
  readonly source: string
  readonly backupPath: string
  readonly logger: Logger
}

interface PreviousSqliteOptions {
  readonly dbPath: string
  readonly backupPath: string
  readonly logger: Logger
}

interface ResetSqliteOptions {
  readonly dbPath: string
  readonly logger: Logger
}

interface SqliteReplacementPaths {
  readonly dbPath: string
  readonly tempPath: string
  readonly stagedPath: string
}

// bun:sqlite opens synchronously.
export function openSqlite(path: string, logger: Logger): Storage {
  const db = openDatabase(path)

  try {
    for (const pragma of PRAGMAS) {
      db.run(pragma)
    }
  } catch (err: unknown) {
    // Don't orphan the handle when a PRAGMA fails after a successful open.
    db.close()
    throw new StorageError(`sqlite pragma failed: ${path}`, err)
  }

  return createStorage(db, logger)
}

export async function restoreSqlite(options: RestoreSqliteOptions): Promise<void> {
  const { dbPath, source, backupPath, logger } = options
  const paths = createSqliteReplacementPaths(dbPath)

  assertRestorableSqliteSource(source)

  // Restore is the one replacement path that never opens a database first, so nothing else has
  // created the directory: on a fresh host — a backup carried to another server — the copy below
  // would fail with a bare ENOENT.
  await mkdir(dirname(dbPath), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })

  try {
    if (await Bun.file(dbPath).exists()) {
      await keepPreviousSqliteDatabase({ dbPath, backupPath, logger })
    }

    await copyFile(source, paths.tempPath)
    await installPreparedSqliteDatabase(paths)
  } finally {
    await removeSqliteFilesQuietly(paths.tempPath)
  }
}

export async function resetSqlite(options: ResetSqliteOptions): Promise<number> {
  const paths = createSqliteReplacementPaths(options.dbPath)

  try {
    const applied = await prepareFreshSqliteDatabase(paths.tempPath, options.logger)

    await installPreparedSqliteDatabase(paths)

    return applied
  } finally {
    await removeSqliteFilesQuietly(paths.tempPath)
  }
}

// WAL/SHM sidecars are never deleted to force an open: a valid WAL can hold committed-but-
// uncheckpointed transactions, and deleting it silently loses them. Genuine corruption is recovered
// from the pre-migration snapshot instead.
function openDatabase(path: string): Database {
  if (path !== IN_MEMORY_PATH) {
    // Same mode `restoreSqlite` uses, so the directory holding the database does not depend on
    // which path happened to create it.
    mkdirSync(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  }

  let db: Database | undefined

  try {
    db = new Database(path)

    if (path !== IN_MEMORY_PATH) {
      // The file is created at the umask when the directory already existed; the WAL and SHM
      // sidecars inherit the mode of this file, so tightening it first covers all three.
      chmodSync(path, PRIVATE_FILE_MODE)
    }

    return db
  } catch (err: unknown) {
    db?.close()

    throw new StorageError(`sqlite open failed: ${formatErrForLog(err).message}`)
  }
}

function createStorage(db: Database, logger: Logger): Storage {
  const tx = createTransaction(db)
  // One connection, and BEGIN IMMEDIATE is per-connection: a bare query/execute run while a
  // transaction is mid-flight would land inside it and commit/roll back with it. Every op chains
  // on this tail so none interleaves with an open transaction. The tail is replaced, never appended.
  let txTail: Promise<unknown> = Promise.resolve()
  let closeTask: Promise<void> | null = null
  let closed = false

  // A failed ROLLBACK closes the handle to avoid a stuck BEGIN IMMEDIATE. Seal the surface to match:
  // later ops report the shutdown instead of raw driver errors, and close() skips pragmas that would
  // now fail against a dead handle.
  const sealClosedHandle = (): void => {
    closed = true
    closeTask ??= Promise.resolve()
  }

  // Boundary rule (persistence/errors.ts): a raw driver error never escapes the Storage surface.
  const enqueue = <T>(op: () => Promise<T>, boundary: string): Promise<T> => {
    // Sealed on close: work queued behind the tail would otherwise run after the handle is gone
    // and fail as a driver error rather than as the shutdown it is.
    if (closed) {
      return Promise.reject(new StorageError('storage is closed'))
    }

    const next = txTail.then(op)
    txTail = next.catch(() => undefined)

    return next.catch((err: unknown) => Promise.reject(toStorageError(err, boundary)))
  }

  // Non-throwing: a close throw would mask whatever triggered the shutdown.
  const closeStorage = async (): Promise<void> => {
    // Let in-flight transactions finish before the handle goes away.
    await txTail

    closeDatabase(db, logger)
  }

  return {
    query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]> {
      return enqueue(() => tx.query<T>(sql, params), 'sqlite query failed')
    },
    execute(sql: string, params?: readonly unknown[]): Promise<{ readonly changes: number }> {
      return enqueue(() => tx.execute(sql, params), 'sqlite execute failed')
    },
    transaction(fn) {
      return enqueue(
        () => runTransaction(db, fn, { logger, seal: sealClosedHandle }),
        'sqlite transaction failed'
      )
    },
    // One shared task: every caller awaits the same close, so a concurrent caller waits for
    // completion instead of returning early and a later caller reuses the settled task.
    close(): Promise<void> {
      closed = true
      closeTask ??= closeStorage()

      return closeTask
    },
  }
}

interface TransactionContext {
  readonly logger: Logger
  readonly seal: () => void
}

// A failed checkpoint must not skip the close: the handle would keep the WAL/SHM locked.
function closeDatabase(db: Database, logger: Logger): void {
  try {
    db.run('PRAGMA optimize')
    db.run(SQLITE_WAL_CHECKPOINT)
  } catch (err: unknown) {
    logger.warn('sqlite.checkpoint_failed', { err: formatErrForLog(err) })
  }

  try {
    db.close()
  } catch (err: unknown) {
    logger.error('sqlite.close_failed', { err: formatErrForLog(err) })
  }
}

async function runTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
  ctx: TransactionContext
): Promise<T> {
  try {
    db.run('BEGIN IMMEDIATE')
  } catch (err: unknown) {
    // Nothing to roll back: the transaction never opened.
    throw toStorageError(err, 'sqlite begin failed')
  }

  try {
    const result = await fn(createTransaction(db))
    db.run('COMMIT')

    return result
  } catch (err: unknown) {
    rollback(db, ctx)
    throw toStorageError(err, 'sqlite transaction failed')
  }
}

function rollback(db: Database, ctx: TransactionContext): void {
  try {
    db.run('ROLLBACK')
  } catch (err: unknown) {
    // ROLLBACK failed: the connection is stuck in BEGIN IMMEDIATE and would block every
    // later writer. Close it so the failure is loud instead of a silent deadlock.
    ctx.logger.error('sqlite.rollback_failed', { err: formatErrForLog(err) })
    try {
      db.close()
    } catch {
      // Unrecoverable; the original error is already on its way to the caller.
    }

    ctx.seal()
  }
}

function createTransaction(db: Database): Transaction {
  return {
    query: async <T>(sql: string, params: readonly unknown[] = []) =>
      // why-safe: `T` is the caller's claim about its own SQL; sqlite returns untyped rows either way.
      db.query(sql).all(...bind(params)) as T[],
    execute: async (sql: string, params: readonly unknown[] = []) => ({
      changes: runWrite(db, sql, params),
    }),
  }
}

function runWrite(db: Database, sql: string, params: readonly unknown[]): number {
  // db.run tolerates DDL and trigger bodies that prepare() would reject on their inner `;`.
  // db.query caches by SQL text, so a hot write reuses one statement; db.prepare would allocate a
  // native statement per call and only release it when the wrapper is collected.
  const result = params.length === 0 ? db.run(sql) : db.query(sql).run(...bind(params))

  return Number(result.changes ?? 0)
}

function bind(params: readonly unknown[]): SQLQueryBindings[] {
  // The Storage contract carries `unknown` params by design.
  // why-safe: SQLite rejects at runtime any value it cannot bind — the check moves, it is not lost.
  return params as SQLQueryBindings[]
}

function createSqliteReplacementPaths(dbPath: string): SqliteReplacementPaths {
  const operationPath = `${dbPath}.${randomUUID()}`

  return {
    dbPath,
    tempPath: `${operationPath}${TEMPORARY_SUFFIX}`,
    stagedPath: `${operationPath}${STAGED_SUFFIX}`,
  }
}

function assertRestorableSqliteSource(source: string): void {
  let db: Database | undefined

  try {
    // immutable: a read-only connection cannot create the -shm a WAL-mode file needs, and only the
    // main file is installed, so that is the content worth checking.
    db = new Database(`${pathToFileURL(source).href}${SQLITE_IMMUTABLE_QUERY}`, { readonly: true })

    const verdict: unknown = db.query('PRAGMA quick_check').values()[0]?.[0]

    if (verdict !== 'ok') {
      throw new StorageError(`restore source failed integrity check: ${String(verdict)}`)
    }
  } catch (err: unknown) {
    if (err instanceof StorageError) {
      throw err
    }

    throw new StorageError(`restore source is not a readable sqlite database: ${source}`, err)
  } finally {
    db?.close()
  }
}

async function keepPreviousSqliteDatabase(options: PreviousSqliteOptions): Promise<void> {
  const { dbPath, backupPath, logger } = options

  await mkdir(dirname(backupPath), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })

  // An unreadable database is the main reason to restore, so it must not block the install: it is
  // moved aside whole instead of copied.
  if (await tryCheckpointSqliteWal(dbPath, logger)) {
    await copyFile(dbPath, backupPath)
  } else {
    await rename(dbPath, backupPath)

    // The WAL travels with its file: sqlite replays it when the copy is next opened.
    for (const suffix of SIDECAR_SUFFIXES) {
      await stageSqliteFile(`${dbPath}${suffix}`, `${backupPath}${suffix}`)
    }
  }

  // The safety copy is the whole database; copyFile would otherwise leave it at the umask.
  await chmod(backupPath, PRIVATE_FILE_MODE)
}

// The WAL of an unclean shutdown holds committed transactions the main file lacks, and the
// sidecars are discarded by the install — folding them in is what makes the copy a whole database.
async function tryCheckpointSqliteWal(dbPath: string, logger: Logger): Promise<boolean> {
  try {
    await checkpointSqliteWal(dbPath, logger)

    return true
  } catch (err: unknown) {
    logger.warn('sqlite.restore_previous_unreadable', { err: formatErrForLog(err) })

    return false
  }
}

async function checkpointSqliteWal(dbPath: string, logger: Logger): Promise<void> {
  const db = openSqlite(dbPath, logger)

  try {
    const [result] = await db.query<{ readonly busy: number }>(SQLITE_WAL_CHECKPOINT)

    // Another reader holding the WAL leaves its commits out of the main file without an error.
    if (result === undefined || result.busy !== 0) {
      throw new StorageError('sqlite wal checkpoint was blocked by another connection')
    }
  } finally {
    await db.close()
  }
}

async function prepareFreshSqliteDatabase(tempPath: string, logger: Logger): Promise<number> {
  const fresh = openSqlite(tempPath, logger)
  let applied = 0

  try {
    applied = await migrate(fresh, sqliteDialect, { logger })
    await fresh.execute(SQLITE_DELETE_JOURNAL_MODE)
  } finally {
    await fresh.close()
  }

  await removeSqliteSidecars(tempPath)

  return applied
}

async function installPreparedSqliteDatabase(paths: SqliteReplacementPaths): Promise<void> {
  const stagedSuffixes: string[] = []
  let installed = false

  try {
    await stageSqliteSidecars(paths, stagedSuffixes)
    await rename(paths.tempPath, paths.dbPath)
    installed = true
  } finally {
    if (installed) {
      await removeSqliteFilesQuietly(paths.stagedPath)
    } else {
      await restoreStagedSqliteSidecars(paths, stagedSuffixes)
    }
  }
}

async function stageSqliteSidecars(
  paths: SqliteReplacementPaths,
  stagedSuffixes: string[]
): Promise<void> {
  for (const suffix of SIDECAR_SUFFIXES) {
    if (await stageSqliteFile(`${paths.dbPath}${suffix}`, `${paths.stagedPath}${suffix}`)) {
      stagedSuffixes.push(suffix)
    }
  }
}

async function removeSqliteSidecars(dbPath: string): Promise<void> {
  for (const suffix of SIDECAR_SUFFIXES) {
    await rm(`${dbPath}${suffix}`, { force: true })
  }
}

async function stageSqliteFile(source: string, staged: string): Promise<boolean> {
  if (!(await Bun.file(source).exists())) {
    return false
  }

  await rename(source, staged)

  return true
}

async function restoreStagedSqliteSidecars(
  paths: SqliteReplacementPaths,
  suffixes: readonly string[]
): Promise<void> {
  for (const suffix of suffixes) {
    try {
      await rename(`${paths.stagedPath}${suffix}`, `${paths.dbPath}${suffix}`)
    } catch {
      // Restoration is best effort and must not mask the original failure.
    }
  }
}

async function removeSqliteFiles(dbPath: string): Promise<void> {
  await rm(dbPath, { force: true })
  await removeSqliteSidecars(dbPath)
}

async function removeSqliteFilesQuietly(dbPath: string): Promise<void> {
  try {
    await removeSqliteFiles(dbPath)
  } catch {
    // Cleanup must not replace the reset or restore result.
  }
}
