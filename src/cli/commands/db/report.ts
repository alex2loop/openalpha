import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import type { DbTable } from '@/persistence/api'
import { pluralKey, t } from '@/i18n'
import { hasTable, TABLE_NAME_WIDTH } from '@/persistence/api'

export interface TableCount {
  readonly name: string
  readonly rows: number
}

/** One line per table, then a blank one, and the total the caller names in its own summary. */
export function printTableCounts(app: CliApp, counts: readonly TableCount[]): number {
  let rows = 0

  for (const count of counts) {
    rows += count.rows
    app.out(`  ${count.name.padEnd(TABLE_NAME_WIDTH)} ${count.rows}`)
  }

  app.out('')

  return rows
}

export function countedTotals(
  locale: Locale,
  rows: number,
  files: number
): { readonly rows: string; readonly files: string } {
  return {
    rows: t(locale, pluralKey(rows, 'cli.dbRowCountOne', 'cli.dbRowCount'), { count: rows }),
    files: t(locale, pluralKey(files, 'cli.dbFileCountOne', 'cli.dbFileCount'), { count: files }),
  }
}

/** A registry newer than the applied schema names tables the database has not created yet, and they
 *  hold nothing to keep, so a read of every table (export, stats) leaves them out rather than failing
 *  before a reset. */
export async function existingTables(
  app: CliApp,
  tables: readonly DbTable[]
): Promise<readonly DbTable[]> {
  const storage = app.resolve('storage')
  const dialect = app.resolve('dialect')
  const existing: DbTable[] = []

  for (const table of tables) {
    if (await hasTable(storage, dialect, table.name)) {
      existing.push(table)
    }
  }

  return existing
}
