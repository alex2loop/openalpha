import { createReadStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

import type { CliApp } from '@/cli/types'
import type { Dialect, Transaction } from '@/core/types/storage'
import type { DbTable } from '@/persistence/api'
import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { flagString } from '@/cli/parsing/args'
import { success } from '@/cli/ui/colors'
import { expandHome } from '@/core/config/resolve'
import { ValidationError } from '@/core/errors'
import { isPlainRecord } from '@/core/utils/collections'
import { type MessageKey, t } from '@/i18n'
import { ALL_TABLE_NAMES, ALL_TABLES, bindChunkSize, findTable } from '@/persistence/api'

import { printTableCounts, type TableCount } from './report'

// csv cannot round-trip: it renders null and an empty string identically and carries no types, so
// the reverse mapping would be a guess made from a column name. json is the only format read back.
const IMPORT_EXTENSION = 'json'
// Interpolated into the INSERT, so it is bounded to an identifier: no quote, space, paren or
// semicolon is expressible, and a name that passes but names no column is rejected by the engine.
const COLUMN_NAME_RE = /^[a-z][a-z0-9_]*$/

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
  const counts = await app.resolve('storage').transaction(async (tx) => {
    const written: TableCount[] = []

    for (const table of req.tables) {
      await assertEmpty(tx, table)
      written.push({
        name: table.name,
        rows: await importTable({ tx, dialect, table, path: tableFile(dir, table) }),
      })
    }

    return written
  })
  const rows = printTableCounts(app, counts)

  app.out(success(t(locale, 'cli.dbImportRead', { rows, files: counts.length, dir })))

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

interface TableImport {
  readonly tx: Transaction
  readonly dialect: Dialect
  readonly table: DbTable
  readonly path: string
}

interface RowShape {
  readonly cols: readonly string[]
  readonly rowsPerStatement: number
}

interface RowValues {
  readonly row: Row
  readonly cols: readonly string[]
  readonly req: TableImport
  readonly line: number
}

// Read a line at a time and flushed by the bind ceiling, so a table's memory cost is one batch
// rather than one file — the same property that makes `db export` page its reads.
async function importTable(req: TableImport): Promise<number> {
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
      batch.push(toValues({ row, cols: shape.cols, req, line }))
      total += 1

      if (batch.length >= shape.rowsPerStatement) {
        await writeBatch(req, shape.cols, batch)
        batch = []
      }
    }

    if (shape !== null && batch.length > 0) {
      await writeBatch(req, shape.cols, batch)
    }

    return total
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

  return { cols, rowsPerStatement: bindChunkSize(cols.length) }
}

function toValues(input: RowValues): readonly unknown[] {
  const { row, req, line } = input
  const values: unknown[] = []

  for (const name of input.cols) {
    if (!(name in row)) {
      throw importError('cli.dbImportBadRow', { table: req.table.name, line, column: name })
    }

    values.push(row[name])
  }

  const extra = Object.keys(row).find((name) => !input.cols.includes(name))

  if (extra !== undefined) {
    throw importError('cli.dbImportExtraColumn', { table: req.table.name, line, column: extra })
  }

  return values
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
