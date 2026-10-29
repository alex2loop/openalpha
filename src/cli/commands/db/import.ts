import { createReadStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import type { CliApp } from '@/cli/types'
import type { Dialect, DialectName, Transaction } from '@/core/types/storage'
import type { DbTable } from '@/persistence/api'
import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { flagString } from '@/cli/parsing/args'
import { success, warn } from '@/cli/ui/colors'
import { expandHome } from '@/core/config/resolve'
import { ValidationError } from '@/core/errors'
import { isPlainRecord } from '@/core/utils/collections'
import { type MessageKey, t } from '@/i18n'
import {
  ALL_TABLE_NAMES,
  ALL_TABLES,
  bindChunkSize,
  findTable,
  stampLastMessages,
} from '@/persistence/api'

import { countedTotals, printTableCounts, type TableCount } from './report'

// csv cannot round-trip: it renders null and an empty string identically and carries no types, so
// the reverse mapping would be a guess made from a column name. json is the only format read back.
const IMPORT_EXTENSION = 'json'
// Interpolated into the INSERT, so it is bounded to an identifier: no quote, space, paren or
// semicolon is expressible, and a name that passes but names no column is rejected by the engine.
const COLUMN_NAME_RE = /^[a-z][a-z0-9_]*$/
// The columns the table has in this release, so an export from an older one still reads back.
const TABLE_COLUMNS_SQL: Readonly<Record<DialectName, string>> = {
  sqlite: 'SELECT name FROM pragma_table_info(?1)',
  postgres:
    'SELECT column_name AS name FROM information_schema.columns ' +
    'WHERE table_schema = current_schema() AND table_name = $1',
}

type Row = Record<string, unknown>

export const dbImportCommand: Command = createCommand({
  name: 'import',
  summary: { key: 'cliHelp.dbImportSummary' },
  spec: {
    flags: {
      in: { type: 'string', describe: { key: 'cliHelp.flagDbImportIn' } },
      table: { type: 'string', describe: { key: 'cliHelp.flagDbImportTable' } },
    },
  },
  // Rows land in the current schema, so a fresh data dir gets its tables before the first insert.
  needs: { bootScope: 'persistence', startup: 'migrate', daemon: 'stopped' },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const from = flagString(args, 'in')

    if (from === undefined) {
      return usage(app, t(locale, 'cli.dbImportUsage'))
    }

    const tables = resolveTables(flagString(args, 'table'))

    if (tables === null) {
      return usage(
        app,
        t(locale, 'cli.dbImportUnknownTable', { names: ALL_TABLE_NAMES.join(', ') })
      )
    }

    const dir = resolve(expandHome(from))
    const present = await presentTables(dir, tables)

    if (present.length === 0) {
      return usage(app, t(locale, 'cli.dbImportNoFiles', { dir }))
    }

    return await readInto({ app, dir, tables: present })
  },
})

// Registry order, not directory order: `sessions` has to land before `session_messages` and
// `llm_attempts`, and `jobs` before `scheduler_runs`, or their foreign keys reject the rows.
function resolveTables(name: string | undefined): readonly DbTable[] | null {
  if (name === undefined) {
    return ALL_TABLES
  }

  const match = findTable(name)

  return match === null ? null : [match]
}

async function presentTables(dir: string, tables: readonly DbTable[]): Promise<readonly DbTable[]> {
  const found: DbTable[] = []

  for (const table of tables) {
    if (await Bun.file(tableFile(dir, table)).exists()) {
      found.push(table)
    }
  }

  return found
}

function tableFile(dir: string, table: DbTable): string {
  return join(dir, `${table.name}.${IMPORT_EXTENSION}`)
}

interface ImportRequest {
  readonly app: CliApp
  readonly dir: string
  readonly tables: readonly DbTable[]
}

// One transaction over every table: a file that fails half way leaves the database exactly as it
// was, so the fix is to correct the file and re-run rather than to reason about what landed.
async function readInto(req: ImportRequest): Promise<number> {
  const { app, dir } = req
  const locale = app.config.locale.language
  const dialect = app.resolve('dialect')
  const imported = await app.resolve('storage').transaction(async (tx) => {
    const written: TableImported[] = []

    for (const table of req.tables) {
      await assertEmpty(tx, table)

      const columns = await tableColumns(tx, dialect, table)

      written.push(await importTable({ tx, dialect, table, columns, path: tableFile(dir, table) }))
    }

    // An older export has no date the conversation list orders by, which would leave its chats out.
    await stampLastMessages(tx)

    return written
  })
  const rows = printTableCounts(app, imported)

  for (const { name, skipped } of imported) {
    if (skipped.length > 0) {
      app.out(
        warn(t(locale, 'cli.dbImportSkippedColumns', { table: name, columns: skipped.join(', ') }))
      )
    }
  }

  app.out(
    success(t(locale, 'cli.dbImportRead', { ...countedTotals(locale, rows, imported.length), dir }))
  )

  return 0
}

/** The table name is the registry's, never the operator's, which is what makes interpolating it
 *  the same argument `db export` makes for its own paging statements. */
async function assertEmpty(tx: Transaction, table: DbTable): Promise<void> {
  const rows = await tx.query(`SELECT 1 AS present FROM ${table.name} LIMIT 1`)

  if (rows.length > 0) {
    throw importError('cli.dbImportTableNotEmpty', { table: table.name })
  }
}

async function tableColumns(
  tx: Transaction,
  dialect: Dialect,
  table: DbTable
): Promise<ReadonlySet<string>> {
  const rows = await tx.query<{ readonly name: string }>(TABLE_COLUMNS_SQL[dialect.name], [
    table.name,
  ])

  return new Set(rows.map((row) => row.name))
}

interface TableImport {
  readonly tx: Transaction
  readonly dialect: Dialect
  readonly table: DbTable
  /** What the table holds now; a file column outside it was dropped since the export. */
  readonly columns: ReadonlySet<string>
  readonly path: string
}

interface TableImported extends TableCount {
  readonly skipped: readonly string[]
}

interface RowShape {
  /** Every column the file's rows carry. */
  readonly fileCols: readonly string[]
  /** The ones written: the file's columns the table still has. */
  readonly cols: readonly string[]
  readonly skipped: readonly string[]
  readonly rowsPerStatement: number
}

interface RowValues {
  readonly row: Row
  readonly shape: RowShape
  readonly req: TableImport
  readonly line: number
}

// Read a line at a time and flushed by the bind ceiling, so a table's memory cost is one batch
// rather than one file — the same property that makes `db export` page its reads.
async function importTable(req: TableImport): Promise<TableImported> {
  const stream = createReadStream(req.path, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })
  let shape: RowShape | null = null
  let batch: (readonly unknown[])[] = []
  let line = 0
  let total = 0

  try {
    for await (const text of lines) {
      line += 1

      if (text.trim() === '') {
        continue
      }

      const row = toRow(text, req, line)
      shape ??= toShape(row, req, line)
      batch.push(toValues({ row, shape, req, line }))
      total += 1

      if (batch.length >= shape.rowsPerStatement) {
        await writeBatch(req, shape.cols, batch)
        batch = []
      }
    }

    if (shape !== null && batch.length > 0) {
      await writeBatch(req, shape.cols, batch)
    }

    return { name: req.table.name, rows: total, skipped: shape?.skipped ?? [] }
  } finally {
    lines.close()
    stream.close()
  }
}

function toRow(text: string, req: TableImport, line: number): Row {
  const parsed = parseLine(text)

  if (!isPlainRecord(parsed)) {
    throw importError('cli.dbImportBadJson', { table: req.table.name, line })
  }

  return parsed
}

function parseLine(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Reported by the caller against the line number, which this scope does not have.
    return null
  }
}

/** The first row fixes the column list for the file: `db export` writes `SELECT *`, so every row of
 *  a table has the same keys; a later row with more or fewer is a hand-edit worth refusing. */
function toShape(row: Row, req: TableImport, line: number): RowShape {
  const cols = Object.keys(row)
  const invalid = cols.find((name) => !COLUMN_NAME_RE.test(name))

  if (cols.length === 0 || invalid !== undefined) {
    throw importError('cli.dbImportBadColumn', {
      table: req.table.name,
      line,
      column: invalid ?? '',
    })
  }

  const kept = cols.filter((name) => req.columns.has(name))

  if (kept.length === 0) {
    throw importError('cli.dbImportBadColumn', {
      table: req.table.name,
      line,
      column: cols[0] ?? '',
    })
  }

  return {
    fileCols: cols,
    cols: kept,
    skipped: cols.filter((name) => !req.columns.has(name)),
    rowsPerStatement: bindChunkSize(kept.length),
  }
}

function toValues(input: RowValues): readonly unknown[] {
  const { row, shape, req, line } = input
  const missing = shape.fileCols.find((name) => !(name in row))

  if (missing !== undefined) {
    throw importError('cli.dbImportBadRow', { table: req.table.name, line, column: missing })
  }

  const extra = Object.keys(row).find((name) => !shape.fileCols.includes(name))

  if (extra !== undefined) {
    throw importError('cli.dbImportExtraColumn', { table: req.table.name, line, column: extra })
  }

  return shape.cols.map((name) => row[name])
}

async function writeBatch(
  req: TableImport,
  cols: readonly string[],
  batch: readonly (readonly unknown[])[]
): Promise<void> {
  await req.tx.execute(
    req.dialect.insert(req.table.name, { cols, rowCount: batch.length }),
    batch.flat()
  )
}

/** Keyed, so the refusal reads in `[locale]` wherever it is printed. */
function importError(
  key: MessageKey,
  params: Readonly<Record<string, string | number>>
): ValidationError {
  return new ValidationError(`db import refused ${key}: ${JSON.stringify(params)}`, { key, params })
}
