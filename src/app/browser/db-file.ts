import type { Logger } from '@/core/logging/logger'
import type { Storage } from '@/core/types/storage'
import type { DatabaseFiles } from '@/persistence/api'
import { formatErrForLog } from '@/core/security/credentials'
import { hasTable, MIGRATIONS_TABLE, migrationStatus, sqliteDialect } from '@/persistence/api'

/** Tables only an installed version writes: a stored call, an alert, a resting exit, an order
 *  intent. A file holding a row of one would put stops and targets on web surfaces, and saving it
 *  back would lose them from the installed book. `brief_snapshots` is not here on purpose: the web
 *  builds briefs too, so its own export carries those rows. */
const INSTALLED_ONLY_TABLES = ['suggestions', 'alerts', 'resting_exits', 'order_intents'] as const

const SQLITE_HEADER = 'SQLite format 3\0'

export type DbFileVerdict = 'ok' | 'invalid' | 'newer-schema' | 'from-installed'

/** Whether `bytes` is a database this build may replace its own with, judged in a scratch copy in
 *  memory so nothing of the working database is touched. Same rule as the boot for a schema ahead
 *  of this build: a migration id it does not declare. */
export async function checkDbFile(
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

    return await judge(scratch)
  } catch (err: unknown) {
    // A file the engine cannot read is the visitor's file, not a fault of ours.
    logger.warn('browser.db_file_unreadable', { err: formatErrForLog(err) })

    return 'invalid'
  } finally {
    await scratch?.close()
  }
}

function hasSqliteHeader(bytes: Uint8Array): boolean {
  return new TextDecoder('latin1').decode(bytes.subarray(0, SQLITE_HEADER.length)) === SQLITE_HEADER
}

async function judge(scratch: Storage): Promise<DbFileVerdict> {
  const check = await scratch.query<{ readonly quick_check: string }>('PRAGMA quick_check')

  if (check.length !== 1 || check[0]?.quick_check !== 'ok') {
    return 'invalid'
  }

  if (!(await hasTable(scratch, sqliteDialect, MIGRATIONS_TABLE))) {
    return 'invalid'
  }

  const status = await migrationStatus(scratch, sqliteDialect)

  if (status.some((migration) => migration.state === 'orphan')) {
    return 'newer-schema'
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
