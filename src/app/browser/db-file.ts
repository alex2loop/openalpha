import type { Logger } from '@/core/logging/logger'
import type { Storage } from '@/core/types/storage'
import type { DatabaseFiles } from '@/persistence/api'
import { formatErrForLog } from '@/core/security/credentials'
import {
  hasTable,
  isUnreadableDatabase,
  MIGRATIONS,
  MIGRATIONS_TABLE,
  migrationStatus,
  sqliteDialect,
} from '@/persistence/api'

/** Tables only an installed version writes: a stored call, an alert, a resting exit, an order
 *  intent, the focus and factor records its runs keep, the buying halt, the themes. A file holding
 *  a row of one would put stops and targets on web surfaces, and saving it back would lose them
 *  from the installed book. `brief_snapshots` is not here on purpose: the web builds briefs too,
 *  so its own export carries those rows. */
const INSTALLED_ONLY_TABLES = [
  'suggestions',
  'alerts',
  'resting_exits',
  'order_intents',
  'order_settings',
  'agent_focuses',
  'factor_log',
  'themes',
  'theme_runs',
  'theme_reads',
  'theme_outcomes',
] as const

const SQLITE_HEADER = 'SQLite format 3\0'
// Header bytes 18 and 19 are the file's write and read format: 2 means WAL, 1 the rollback journal.
const FORMAT_VERSION_OFFSETS = [18, 19] as const
const WAL_FORMAT = 2
const ROLLBACK_FORMAT = 1

// `sqlite_` names are sqlite's own (sequences, statistics); a prefix match with LIKE would also
// skip a visitor-named `sqliteX` table, since `_` is a wildcard there.
const SCHEMA_OBJECTS_SQL =
  "SELECT type, name, sql FROM sqlite_master WHERE substr(name, 1, 7) <> 'sqlite_'"

interface SchemaObject {
  readonly type: string
  readonly name: string
  readonly sql: string | null
}

/** `failed` is the tab being unable to look (memory), not a verdict on the file. */
export type DbFileVerdict = 'ok' | 'invalid' | 'newer-schema' | 'from-installed' | 'failed'

/** Whether `bytes` is a database this build may replace its own with, judged in a scratch copy in
 *  memory so nothing of the working database is touched. Same rule as the boot for a schema ahead
 *  of this build: a migration id it does not declare. Never throws. */
export async function toDbFileVerdict(
  files: DatabaseFiles,
  bytes: Uint8Array,
  logger: Logger
): Promise<DbFileVerdict> {
  if (!hasSqliteHeader(bytes)) {
    return 'invalid'
  }

  let scratch: Storage | undefined

  try {
    scratch = files.openScratch(bytes)

    return await toScratchVerdict({ files, scratch, logger })
  } catch (err: unknown) {
    // A file sqlite refuses is the visitor's file, not a fault of ours.
    if (isUnreadableDatabase(err)) {
      logger.warn('browser.db_file_unreadable', { err: formatErrForLog(err) })

      return 'invalid'
    }

    logger.error('browser.db_file_check_failed', { err: formatErrForLog(err) })

    return 'failed'
  } finally {
    await closeScratch(scratch, logger)
  }
}

/** A copied installed database is often still marked WAL, which the in-memory engine cannot open
 *  without its `-wal` file. The copy holds every page the main file has, so it is read as a
 *  rollback-journal file instead; the bytes the caller holds are not changed. */
export function toRollbackJournal(bytes: Uint8Array): Uint8Array {
  if (!FORMAT_VERSION_OFFSETS.some((offset) => bytes[offset] === WAL_FORMAT)) {
    return bytes
  }

  const copy = bytes.slice()

  for (const offset of FORMAT_VERSION_OFFSETS) {
    copy[offset] = ROLLBACK_FORMAT
  }

  return copy
}

function hasSqliteHeader(bytes: Uint8Array): boolean {
  return new TextDecoder('latin1').decode(bytes.subarray(0, SQLITE_HEADER.length)) === SQLITE_HEADER
}

interface ScratchCheck {
  readonly files: DatabaseFiles
  readonly scratch: Storage
  readonly logger: Logger
}

async function toScratchVerdict(check: ScratchCheck): Promise<DbFileVerdict> {
  const { scratch } = check
  const integrity = await scratch.query<{ readonly quick_check: string }>('PRAGMA quick_check')

  if (integrity.length !== 1 || integrity[0]?.quick_check !== 'ok') {
    return 'invalid'
  }

  if (!(await hasTable(scratch, sqliteDialect, MIGRATIONS_TABLE))) {
    return 'invalid'
  }

  const status = await migrationStatus(scratch, sqliteDialect)

  if (status.some((migration) => migration.state === 'orphan')) {
    return 'newer-schema'
  }

  const appliedIds = new Set(
    status.filter((migration) => migration.state === 'applied').map((migration) => migration.id)
  )

  if (!(isLeadingMigrations(appliedIds) && (await hasOnlyOwnSchema(check, appliedIds)))) {
    return 'invalid'
  }

  for (const table of INSTALLED_ONLY_TABLES) {
    if ((await hasTable(scratch, sqliteDialect, table)) && (await hasRows(scratch, table))) {
      return 'from-installed'
    }
  }

  return 'ok'
}

// The runner applies migrations in order, so a file listing any other set was not made by one.
function isLeadingMigrations(appliedIds: ReadonlySet<string>): boolean {
  return MIGRATIONS.slice(0, appliedIds.size).every((migration) => appliedIds.has(migration.id))
}

async function hasRows(scratch: Storage, table: string): Promise<boolean> {
  const rows = await scratch.query(`SELECT 1 FROM ${table} LIMIT 1`)

  return rows.length > 0
}

/** A file may carry the tables, indexes, triggers and views the migrations it has applied make and
 *  nothing else: a foreign trigger or view would run its own SQL inside the visitor's writes. The
 *  expected set is read from a blank database given exactly those migrations, never listed by hand,
 *  so a file older than a migration that rewrote an index or trigger still matches its own era. A
 *  table is judged by name, since its text grows as migrations add columns; a trigger or view by
 *  name and text, since the same name with another body is exactly the thing to refuse. */
async function hasOnlyOwnSchema(
  check: ScratchCheck,
  appliedIds: ReadonlySet<string>
): Promise<boolean> {
  const own = await readOwnSchema(check, appliedIds)
  const foreign = (await readSchemaObjects(check.scratch)).find(
    (object) => !isOwnObject(object, own)
  )

  if (foreign !== undefined) {
    check.logger.warn('browser.db_file_foreign_schema', {
      type: foreign.type,
      name: foreign.name,
    })
  }

  return foreign === undefined
}

async function readOwnSchema(
  check: ScratchCheck,
  appliedIds: ReadonlySet<string>
): Promise<ReadonlyMap<string, string | null>> {
  const blank = check.files.openBlank()

  try {
    await blank.transaction(async (tx) => {
      for (const migration of MIGRATIONS) {
        if (appliedIds.has(migration.id)) {
          await migration.up(tx, sqliteDialect)
        }
      }
    })

    const own = new Map<string, string | null>()

    for (const object of await readSchemaObjects(blank)) {
      own.set(toObjectKey(object), object.sql)
    }
    // The ledger is the runner's, not a migration's, and the file already proved it holds one.
    own.set(toObjectKey({ type: 'table', name: MIGRATIONS_TABLE, sql: null }), null)

    return own
  } finally {
    await closeScratch(blank, check.logger)
  }
}

function readSchemaObjects(db: Storage): Promise<readonly SchemaObject[]> {
  return db.query<SchemaObject>(SCHEMA_OBJECTS_SQL)
}

function isOwnObject(object: SchemaObject, own: ReadonlyMap<string, string | null>): boolean {
  const key = toObjectKey(object)

  return own.has(key) && (object.type === 'table' || own.get(key) === object.sql)
}

function toObjectKey(object: SchemaObject): string {
  return `${object.type}:${object.name}`
}

async function closeScratch(scratch: Storage | undefined, logger: Logger): Promise<void> {
  await scratch?.close().catch((err: unknown) => {
    logger.warn('browser.db_scratch_close_failed', { err: formatErrForLog(err) })
  })
}
