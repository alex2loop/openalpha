import type { CliApp } from '@/cli/types'
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
