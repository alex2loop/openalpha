import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import { pluralKey, t } from '@/i18n'
import { TABLE_NAME_WIDTH } from '@/persistence/api'

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
