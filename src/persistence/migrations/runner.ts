import { join } from 'node:path'

import type { Logger } from '@/core/logging/logger'
import type { Dialect, Storage, Transaction } from '@/core/types/storage'
import type { Migration } from '@/persistence/types'
import { StorageError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { backupAndPrune } from '@/persistence/backup'
import { MIGRATIONS } from '@/persistence/migrations/registry.generated'

const PRE_MIGRATION_SUBDIR = 'pre-migration'
// Any stable string works: hashtext(...) only needs a consistent input so every process derives
// the same advisory-lock key. Distinct from any other lock name used elsewhere (e.g. the ledger's).
const MIGRATION_LOCK_NAME = 'persistence_migrations'

// Exported because `doctor` reads this table through a raw readonly `bun:sqlite` handle rather than
// `Storage`, so no helper below spans both readers — the SQL itself is what the two must agree on.
export const MIGRATIONS_TABLE = '_migrations'
export const MIGRATION_IDS_SQL = `SELECT id FROM ${MIGRATIONS_TABLE}`
export const SQLITE_MIGRATIONS_TABLE_SQL = `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${MIGRATIONS_TABLE}'`
export const POSTGRES_MIGRATIONS_TABLE_SQL = `SELECT to_regclass('${MIGRATIONS_TABLE}') AS name`
const SQLITE_TABLE_SQL = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
const POSTGRES_TABLE_SQL = 'SELECT to_regclass($1) AS name'

export interface MigrateOptions {
  readonly logger: Logger
  /** Trading and plugins append theirs; ids must be unique and are applied in lexicographic order. */
  readonly migrations?: readonly Migration[]
  /** Where to write a pre-migration snapshot (sqlite only). Omitted by `db reset` (nothing to snapshot). */
  readonly backupDir?: string
}

/** `orphan` = applied to this DB but no longer declared — a downgrade or a deleted migration. */
export interface MigrationStatus {
  readonly id: string
  readonly state: 'applied' | 'pending' | 'orphan'
  readonly appliedAtMs: number | null
}

/**
 * Idempotent: applies only ids absent from `_migrations`. Returns how many ran.
 *
 * Read-decide-apply-record runs inside one locked transaction, so two processes booting against
 * the same database cannot both compute the same pending list and race to record it. The batch is
 * therefore all-or-nothing: a failure partway through rolls back the migrations applied earlier in
 * the same call, which is the accepted price of removing the race.
 */
export type MigrationRollbackResolution =
  | { readonly kind: 'ready'; readonly id: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'irreversible'; readonly id: string }
  | { readonly kind: 'orphan'; readonly ids: readonly string[] }
  | { readonly kind: 'gap'; readonly id: string }

export type MigrationRollbackResult =
  | { readonly kind: 'rolled_back'; readonly id: string }
  | { readonly kind: 'history_changed' }

export interface RollbackMigrationOptions {
  readonly expectedId: string
  readonly logger: Logger
  readonly migrations?: readonly Migration[]
}

export async function migrate(
  db: Storage,
  dialect: Dialect,
  options: MigrateOptions
): Promise<number> {
  const migrations = resolveMigrations(options.migrations)

  await maybeBackupBeforeMigrating({ db, dialect, migrations, options })

  const declaredIds = new Set(migrations.map((m) => m.id))
  const result = await db.transaction((tx) =>
    applyPendingLocked({ tx, dialect, logger: options.logger, migrations, declaredIds })
  )

  // Migrations are forward-only, so a DB carrying ids this binary never declares is ahead of it:
  // boot proceeds against a schema it cannot reason about, and the operator must hear about it.
  if (result.orphans.length > 0) {
    options.logger.warn('migration.schema_ahead_of_binary', { orphans: result.orphans })
  }

  return result.applied
}

interface MaybeBackupOptions {
  readonly db: Storage
  readonly dialect: Dialect
  readonly migrations: readonly Migration[]
  readonly options: MigrateOptions
}

// A stale/missing precheck can only cost an unnecessary (or skipped) backup, never a missed or
// duplicated migration: the lock inside `applyPendingLocked` re-reads before anything is applied.
async function maybeBackupBeforeMigrating(input: MaybeBackupOptions): Promise<void> {
  const { db, dialect, migrations, options } = input

  if (dialect.name !== 'sqlite' || options.backupDir === undefined) {
    return
  }

  const exists = await hasLedger(db, dialect)
  const applied = exists ? await readApplied(db) : new Map<string, number>()
  const maybePending = migrations.some((m) => !applied.has(m.id))

  if (!maybePending) {
    return
  }

  const dir = join(options.backupDir, PRE_MIGRATION_SUBDIR)

  try {
    const path = await backupAndPrune({ db, dir })

    options.logger.info('migration.backup_taken', { path })
  } catch (err: unknown) {
    options.logger.warn('migration.backup_failed', { path: dir, err: formatErrForLog(err) })
  }
}

/** Read-only counterpart of migrate(): what the DB has, what it is missing, what it no longer knows. */
export async function migrationStatus(
  db: Storage,
  dialect: Dialect,
  migrations: readonly Migration[] = []
): Promise<readonly MigrationStatus[]> {
  const declared = resolveMigrations(migrations)
  const applied = (await hasLedger(db, dialect)) ? await readApplied(db) : new Map<string, number>()
  const declaredIds = new Set(declared.map((m) => m.id))
  const fromDeclared: readonly MigrationStatus[] = declared.map((m) => ({
    id: m.id,
    state: applied.has(m.id) ? 'applied' : 'pending',
    appliedAtMs: applied.get(m.id) ?? null,
  }))
  const orphans: readonly MigrationStatus[] = [...applied]
    .filter(([id]) => !declaredIds.has(id))
    .map(([id, appliedAtMs]) => ({ id, state: 'orphan', appliedAtMs }))

  return [...fromDeclared, ...orphans].sort((a, b) => a.id.localeCompare(b.id))
}

// Core schema always applies; extensions append theirs. `assertUniqueIds` catches collisions.
function resolveMigrations(additional: readonly Migration[] = []): readonly Migration[] {
  const migrations = [...MIGRATIONS, ...additional].sort((a, b) => a.id.localeCompare(b.id))

  assertUniqueIds(migrations)

  return migrations
}

// Only the read half of Storage/Transaction: both satisfy this structurally, so the same helpers
// serve the unlocked precheck (against `db`) and the locked apply (against `tx`).
interface Queryable {
  query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>
}

function hasLedger(db: Queryable, dialect: Dialect): Promise<boolean> {
  return hasTable(db, dialect, MIGRATIONS_TABLE)
}

/** Whether the schema holds a table: a registry newer than the applied schema names tables the
 *  database has not created yet. */
export async function hasTable(db: Queryable, dialect: Dialect, table: string): Promise<boolean> {
  if (dialect.name === 'sqlite') {
    const rows = await db.query<{ readonly name: string }>(SQLITE_TABLE_SQL, [table])

    return rows.length > 0
  }

  const rows = await db.query<{ readonly name: string | null }>(POSTGRES_TABLE_SQL, [table])

  return rows[0]?.name !== null && rows[0]?.name !== undefined
}

function assertUniqueIds(migrations: readonly Migration[]): void {
  const seen = new Set<string>()

  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new StorageError(`duplicate migration id: ${migration.id}`)
    }
    seen.add(migration.id)
  }
}

async function readApplied(db: Queryable): Promise<ReadonlyMap<string, number>> {
  const rows = await db.query<{ readonly id: string; readonly applied_at: number }>(
    `SELECT id, applied_at FROM ${MIGRATIONS_TABLE}`
  )

  return new Map(rows.map((r) => [r.id, Number(r.applied_at)]))
}

interface ApplyPendingOptions {
  readonly tx: Transaction
  readonly dialect: Dialect
  readonly logger: Logger
  readonly migrations: readonly Migration[]
  readonly declaredIds: ReadonlySet<string>
}

interface ApplyPendingResult {
  readonly applied: number
  readonly orphans: readonly string[]
}

// Locks first, then re-reads `applied`: that order is what closes the race described on migrate().
async function applyPendingLocked(options: ApplyPendingOptions): Promise<ApplyPendingResult> {
  const { tx, dialect, logger, migrations, declaredIds } = options

  await acquireMigrationLock(tx, dialect)
  await ensureLedgerTx(tx)

  await relaxTransactionTimeouts(tx, dialect)

  const applied = await readApplied(tx)
  const pending = migrations.filter((m) => !applied.has(m.id))
  const orphans = [...applied.keys()].filter((id) => !declaredIds.has(id))

  for (const migration of pending) {
    await applyOne({ tx, dialect, logger, migration })
  }

  return { applied: pending.length, orphans }
}

// Heavy migrations are boot-time, one-time work; do not let the runtime pool's timeouts abort them
// mid-transaction and force a wholesale retry. SQLite has neither to override.
async function relaxTransactionTimeouts(tx: Transaction, dialect: Dialect): Promise<void> {
  if (dialect.name !== 'postgres') {
    return
  }

  await tx.execute('SET LOCAL statement_timeout = 0')
  await tx.execute('SET LOCAL idle_in_transaction_session_timeout = 0')
}

// Sqlite already serializes the batch through BEGIN IMMEDIATE's file-wide lock; postgres has no
// equivalent, so it takes a transaction-scoped advisory lock that releases on commit or rollback.
async function acquireMigrationLock(tx: Transaction, dialect: Dialect): Promise<void> {
  if (dialect.name !== 'postgres') {
    return
  }

  await tx.execute(`SELECT pg_advisory_xact_lock(hashtext(${dialect.param(1)}))`, [
    MIGRATION_LOCK_NAME,
  ])
}

async function ensureLedgerTx(tx: Transaction): Promise<void> {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
       id TEXT PRIMARY KEY,
       applied_at BIGINT NOT NULL
     )`
  )
}

interface ApplyOneOptions {
  readonly tx: Transaction
  readonly dialect: Dialect
  readonly logger: Logger
  readonly migration: Migration
}

async function applyOne(options: ApplyOneOptions): Promise<void> {
  const { tx, dialect, logger, migration } = options

  try {
    await migration.up(tx, dialect)
    await tx.execute(
      `INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (${dialect.paramList(2)})`,
      [migration.id, Date.now()]
    )
  } catch (err: unknown) {
    logger.error('migration.failed', { id: migration.id, err: formatErrForLog(err) })
    throw err
  }

  logger.info('migration.applied', { id: migration.id })
}

/** What the latest applied migration is, and whether it can be undone. Separate from the rollback
 *  itself so a surface can explain the refusal before anything is attempted; the transaction
 *  re-resolves under the lock, because history can move in between. */
export async function resolveMigrationRollback(
  db: Storage,
  dialect: Dialect,
  migrations: readonly Migration[] = []
): Promise<MigrationRollbackResolution> {
  const declared = resolveMigrations(migrations)

  if (!(await hasLedger(db, dialect))) {
    return { kind: 'none' }
  }

  return resolveRollbackFromHistory(declared, await readApplied(db))
}

export async function rollbackMigration(
  db: Storage,
  dialect: Dialect,
  options: RollbackMigrationOptions
): Promise<MigrationRollbackResult> {
  const migrations = resolveMigrations(options.migrations)

  try {
    const result = await db.transaction((tx) =>
      rollbackInTransaction(tx, { dialect, migrations, expectedId: options.expectedId })
    )

    if (result.kind === 'rolled_back') {
      options.logger.info('migration.rolled_back', { id: result.id })
    }

    return result
  } catch (err: unknown) {
    options.logger.error('migration.rollback_failed', {
      id: options.expectedId,
      err: formatErrForLog(err),
    })
    throw err
  }
}

/** Only the newest applied migration is reversible, and only against an unbroken history: an orphan
 *  means the database ran migrations this binary cannot undo, and a gap means the recorded order is
 *  not the declared one, so neither can name a safe target. */
function resolveRollbackFromHistory(
  migrations: readonly Migration[],
  applied: ReadonlyMap<string, number>
): MigrationRollbackResolution {
  const declaredIds = new Set(migrations.map((migration) => migration.id))
  const orphans = [...applied.keys()]
    .filter((id) => !declaredIds.has(id))
    .sort((left, right) => left.localeCompare(right))

  if (orphans.length > 0) {
    return { kind: 'orphan', ids: orphans }
  }

  let firstMissing: string | undefined
  let latest: Migration | undefined

  for (const migration of migrations) {
    if (!applied.has(migration.id)) {
      firstMissing ??= migration.id
      continue
    }

    if (firstMissing !== undefined) {
      return { kind: 'gap', id: firstMissing }
    }

    latest = migration
  }

  if (latest === undefined) {
    return { kind: 'none' }
  }

  if (latest.reversibility === 'irreversible') {
    return { kind: 'irreversible', id: latest.id }
  }

  return { kind: 'ready', id: latest.id }
}

interface RollbackTransactionOptions {
  readonly dialect: Dialect
  readonly migrations: readonly Migration[]
  readonly expectedId: string
}

/** Everything is re-read under the same lock the apply path takes, and the caller's expected id has
 *  to still be the target: `history_changed` says another process moved the ledger between the
 *  operator being told what would be undone and this transaction running. */
async function rollbackInTransaction(
  tx: Transaction,
  options: RollbackTransactionOptions
): Promise<MigrationRollbackResult> {
  const { dialect, migrations, expectedId } = options

  await acquireMigrationLock(tx, dialect)
  await relaxTransactionTimeouts(tx, dialect)

  if (!(await hasLedger(tx, dialect))) {
    return { kind: 'history_changed' }
  }

  const resolution = resolveRollbackFromHistory(migrations, await readApplied(tx))

  if (resolution.kind !== 'ready' || resolution.id !== expectedId) {
    return { kind: 'history_changed' }
  }

  const migration = migrations.find((entry) => entry.id === resolution.id)

  if (migration?.reversibility !== 'reversible') {
    return { kind: 'history_changed' }
  }

  await migration.down(tx, dialect)

  const deletion = await tx.execute(
    `DELETE FROM ${MIGRATIONS_TABLE} WHERE id = ${dialect.param(1)}`,
    [migration.id]
  )

  if (deletion.changes !== 1) {
    throw new StorageError(`migration ledger changed while rolling back: ${migration.id}`)
  }

  return { kind: 'rolled_back', id: migration.id }
}
