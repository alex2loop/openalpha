import { Database } from 'bun:sqlite'
import { lstat } from 'node:fs/promises'

import type { ResolvedStorageConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { Migration } from '@/persistence/api'
import { isErrno } from '@/core/errors'
import { t } from '@/i18n'
import { MIGRATION_IDS_SQL, MIGRATIONS_TABLE, SQLITE_MIGRATIONS_TABLE_SQL } from '@/persistence/api'
import { PROFILE_CURRENCY_SQL } from '@/trading/api'

import type { DoctorProbe, DoctorStatus } from './types'
import { migrationsUpToDate } from './local-probes'
import { probePostgresDatabase } from './postgres-probe'

const INTEGRITY_CHECK_SQL = 'PRAGMA integrity_check'
/** Cheapest statement that still forces the deferred file open. */
const OPEN_PROBE_SQL = 'SELECT 1'
/** Makes the fallback handle refuse writes, so read-only is enforced rather than merely asked for. */
const QUERY_ONLY_SQL = 'PRAGMA query_only = 1'

type DatabaseOptions = NonNullable<ConstructorParameters<typeof Database>[1]>

interface IntegrityRow {
  readonly integrity_check: string
}

interface ProfileCurrencyRow {
  readonly base_currency: string
}

interface MigrationRow {
  readonly id: string
}

interface TableRow {
  readonly name: string | null
}

export async function probeDatabase(options: {
  readonly storage: ResolvedStorageConfig
  readonly migrations: readonly Migration[]
  readonly online: boolean
  readonly locale: Locale
  /** The `[locale] currency` the book must have been opened in. */
  readonly currency?: string
}): Promise<DoctorProbe> {
  const locale = options.locale

  if (options.storage.engine === 'sqlite') {
    return probeSqliteDatabase({
      path: options.storage.path,
      migrations: options.migrations,
      locale,
      ...(options.currency === undefined ? {} : { currency: options.currency }),
    })
  }

  if (!options.online) {
    return databaseProbe('ok', postgresTarget(options.storage), 'not probed (use --online)')
  }

  return probePostgresDatabase(options.storage, options.migrations, locale)
}

interface SqliteProbeOptions {
  readonly path: string
  readonly migrations: readonly Migration[]
  readonly locale: Locale
  readonly currency?: string
}

async function probeSqliteDatabase(options: SqliteProbeOptions): Promise<DoctorProbe> {
  const { path, locale } = options
  const preflight = await preflightDatabase(path, locale)

  if (preflight !== null) {
    return preflight
  }

  const database = openDatabase(path)

  if (database === null) {
    return databaseProbe('fail', path, t(locale, 'cli.doctorCannotOpenDatabase'))
  }

  try {
    const integrity = database.query<IntegrityRow, []>(INTEGRITY_CHECK_SQL).get()
    const result = integrity?.integrity_check ?? 'unknown'

    if (result !== 'ok') {
      return databaseProbe('fail', path, t(locale, 'cli.doctorIntegrityCheckFailed', { result }))
    }

    if (!hasMigrationLedger(database)) {
      return databaseProbe(
        'fail',
        path,
        t(locale, 'cli.doctorMigrationsTableMissing', { table: MIGRATIONS_TABLE })
      )
    }

    const applied = database.query<MigrationRow, []>(MIGRATION_IDS_SQL).all()
    const migrated = migrationProbe({ path, migrations: options.migrations, applied, locale })

    return migrated.status === 'ok' ? currencyProbe(database, options, migrated) : migrated
  } catch {
    return databaseProbe('fail', path, t(locale, 'cli.doctorCannotBeInspected'))
  } finally {
    closeQuietly(database)
  }
}

/** The book's currency is fixed by its first profile; a `[locale] currency` edited since leaves
 *  every portfolio read refused, so the mismatch is named here before the operator meets it. */
function currencyProbe(
  database: Database,
  options: SqliteProbeOptions,
  migrated: DoctorProbe
): DoctorProbe {
  const stored = database.query<ProfileCurrencyRow, []>(PROFILE_CURRENCY_SQL).get()?.base_currency

  if (options.currency === undefined || stored === undefined || stored === options.currency) {
    return migrated
  }

  return databaseProbe(
    'fail',
    options.path,
    t(options.locale, 'errors.configCurrencyLocked', {
      currency: options.currency,
      profileCurrency: stored,
    })
  )
}

async function preflightDatabase(path: string, locale: Locale): Promise<DoctorProbe | null> {
  try {
    const info = await lstat(path)

    if (info.isSymbolicLink() || !info.isFile()) {
      return databaseProbe('fail', path, t(locale, 'cli.doctorMustBeRealFile'))
    }

    return null
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return databaseProbe('warn', path, t(locale, 'cli.doctorNotCreatedYet'))
    }

    return databaseProbe('fail', path, t(locale, 'cli.doctorCannotBeInspected'))
  }
}

/** A WAL database cannot be read through a read-only handle unless its `-shm` file already
 *  exists, because SQLite refuses to create one from a read-only connection. This book runs in
 *  WAL, so a stopped daemon leaves the probe nothing to attach to and every statement fails -
 *  which is why `doctor` reported an uninspectable database exactly when nothing was wrong with it.
 *
 *  Read-only is still what we ask for first. The read-write fallback is what lets SQLite build the
 *  `-shm` it needs, and `QUERY_ONLY_SQL` is what keeps the handle from being able to use it for
 *  anything else: a diagnostic must not be the thing that writes to the operator's book. The
 *  fallback does leave a `-shm` and an empty `-wal` beside the database, which the daemon recreates
 *  on its next start.
 *
 *  `bun:sqlite` defers the file open to the first statement, so the failure arrives as a throwing
 *  query rather than a throwing constructor. `OPEN_PROBE_SQL` is what forces it. */
function openDatabase(path: string): Database | null {
  return openWith(path, { readonly: true }) ?? openWith(path, { readwrite: true })
}

function openWith(path: string, flags: DatabaseOptions): Database | null {
  let database: Database | undefined

  try {
    database = new Database(path, flags)
    database.run(QUERY_ONLY_SQL)
    database.query(OPEN_PROBE_SQL).get()

    return database
  } catch {
    closeQuietly(database)

    return null
  }
}

/** Closing is best-effort and must never hide the probe's own result. */
function closeQuietly(database: Database | undefined): void {
  try {
    database?.close()
  } catch {
    // Nothing here can improve on the result the caller already has.
  }
}

function hasMigrationLedger(database: Database): boolean {
  return database.query<TableRow, []>(SQLITE_MIGRATIONS_TABLE_SQL).get() !== null
}

function migrationProbe(options: {
  readonly path: string
  readonly migrations: readonly Migration[]
  readonly applied: readonly MigrationRow[]
  readonly locale: Locale
}): DoctorProbe {
  const appliedIds = new Set(options.applied.map((migration) => migration.id))
  const declaredIds = new Set(options.migrations.map((migration) => migration.id))
  const pending = options.migrations
    .filter((migration) => !appliedIds.has(migration.id))
    .map((m) => m.id)
  const orphaned = options.applied
    .filter((migration) => !declaredIds.has(migration.id))
    .map((m) => m.id)

  if (pending.length === 0 && orphaned.length === 0) {
    return databaseProbe(
      'ok',
      options.path,
      migrationsUpToDate(options.locale, options.applied.length)
    )
  }

  const none = t(options.locale, 'cli.doctorNone')
  return databaseProbe(
    'warn',
    options.path,
    t(options.locale, 'cli.doctorMigrationsPendingOrphaned', {
      pending: pending.join(', ') || none,
      orphaned: orphaned.join(', ') || none,
    })
  )
}

function databaseProbe(status: DoctorStatus, path: string, detail: string): DoctorProbe {
  return { name: 'database', status, detail: `${path} (${detail})` }
}

function postgresTarget(
  storage: Extract<ResolvedStorageConfig, { readonly engine: 'postgres' }>
): string {
  return `postgres schema ${storage.schema}`
}
