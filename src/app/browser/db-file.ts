import type { Logger } from '@/core/logging/logger'
import type { Storage } from '@/core/types/storage'
import type { DatabaseFiles } from '@/persistence/api'
import { silentLogger } from '@/core/logging/silent-logger'
import { formatErrForLog } from '@/core/security/credentials'
import {
  hasTable,
  isUnreadableDatabase,
  MIGRATIONS_TABLE,
  migrate,
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

  if (!(await hasOnlyOwnSchema(check))) {
    return 'invalid'
  }

  for (const table of INSTALLED_ONLY_TABLES) {
    if ((await hasTable(scratch, sqliteDialect, table)) && (await hasRows(scratch, table))) {
      return 'from-installed'
    }
  }

  return 'ok'
}

async function hasRows(scratch: Storage, table: string): Promise<boolean> {
  const rows = await scratch.query(`SELECT 1 FROM ${table} LIMIT 1`)

  return rows.length > 0
}

/** A file may carry the tables, indexes, triggers and views this build's migrations make and
 *  nothing else: a foreign trigger or view would run its own SQL inside the visitor's writes. The
 *  expected set is read from a blank database migrated here, never listed by hand. A table is
 *  judged by name, since its text grows as migrations add columns; a trigger or view by name and
 *  text, since the same name with another body is exactly the thing to refuse. */
async function hasOnlyOwnSchema(check: ScratchCheck): Promise<boolean> {
  const own = await readOwnSchema(check.files, check.logger)
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
  files: DatabaseFiles,
  logger: Logger
): Promise<ReadonlyMap<string, string | null>> {
  const blank = files.openBlank()

  try {
    await migrate(blank, sqliteDialect, { logger: silentLogger })

    const objects = await readSchemaObjects(blank)

    return new Map(objects.map((object) => [toObjectKey(object), object.sql]))
  } finally {
    await closeScratch(blank, logger)
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
