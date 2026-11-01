import type { FileHandle } from 'node:fs/promises'
import { mkdir, mkdtemp, open, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import type { CliApp } from '@/cli/types'
import type { DbTable, Dialect, Storage } from '@/persistence/api'
import { type Command, createCommand } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { flagBool, flagString } from '@/cli/parsing/args'
import { success } from '@/cli/ui/colors'
import { expandHome } from '@/core/config/resolve'
import {
  ensurePrivateDirectory,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
} from '@/core/security/private-files'
import { t } from '@/i18n'
import { ALL_TABLE_NAMES, DURABLE_TABLES, findTable, hasTable } from '@/persistence/api'

import { countedTotals, printTableCounts, type TableCount } from './report'

const EXPORT_FORMATS = ['json', 'csv'] as const
const PAGE_SIZE = 5000
const STAGE_SUFFIX = '.part'
const CSV_QUOTE_RE = /["\n\r,]/

type ExportFormat = (typeof EXPORT_FORMATS)[number]
type Row = Record<string, unknown>

export const dbExportCommand: Command = createCommand({
  name: 'export',
  summary: { key: 'cliHelp.dbExportSummary' },
  spec: {
    flags: {
      out: { type: 'string', describe: { key: 'cliHelp.flagDbExportOut' } },
      table: { type: 'string', describe: { key: 'cliHelp.flagDbExportTable' } },
      format: {
        type: 'string',
        choices: EXPORT_FORMATS,
        describe: { key: 'cliHelp.flagDbExportFormat' },
      },
      force: { type: 'boolean', describe: { key: 'cliHelp.flagDbExportForce' } },
    },
  },
  needs: { bootScope: 'persistence', startup: 'none', daemon: 'any', local: true },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language
    const out = flagString(args, 'out')

    if (out === undefined) {
      return usage(app, t(locale, 'cli.dbExportUsage'))
    }

    const tables = resolveTables(flagString(args, 'table'))

    if (tables === null) {
      return usage(
        app,
        t(locale, 'cli.dbExportUnknownTable', { names: ALL_TABLE_NAMES.join(', ') })
      )
    }

    const dir = resolve(expandHome(out))

    if (!flagBool(args, 'force') && (await hasEntries(dir))) {
      return usage(app, t(locale, 'cli.dbExportDirNotEmpty', { dir }))
    }

    const present = await presentTables(app, tables)

    for (const table of tables.filter((candidate) => !present.includes(candidate))) {
      app.out(t(locale, 'cli.dbExportSkippedMissing', { table: table.name }))
    }

    return writeExport({
      app,
      dir,
      tables: present,
      format: toFormat(flagString(args, 'format')),
    })
  },
})

// Without `--table` the default is the durable set: market data is skipped because `refresh`
// re-derives it. An explicit `--table` still reaches every table.
function resolveTables(name: string | undefined): readonly DbTable[] | null {
  if (name === undefined) {
    return DURABLE_TABLES
  }

  const match = findTable(name)

  return match === null ? null : [match]
}

/** A registry newer than the applied schema names tables the database has not created yet, and they
 *  hold nothing to keep, so the export leaves them out rather than failing before a reset. */
async function presentTables(app: CliApp, tables: readonly DbTable[]): Promise<readonly DbTable[]> {
  const storage = app.resolve('storage')
  const dialect = app.resolve('dialect')
  const present: DbTable[] = []

  for (const table of tables) {
    if (await hasTable(storage, dialect, table.name)) {
      present.push(table)
    }
  }

  return present
}

async function hasEntries(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length > 0
  } catch {
    // A missing directory is the ordinary case - the export creates it.
    return false
  }
}

// json is the default because it is the format `db import` reads: it keeps types, and it is the
// only one that can tell a null from an empty string. csv is for reading, and does not round-trip.
function toFormat(raw: string | undefined): ExportFormat {
  return raw === 'csv' ? 'csv' : 'json'
}

interface ExportRequest {
  readonly app: CliApp
  readonly dir: string
  readonly tables: readonly DbTable[]
  readonly format: ExportFormat
}

async function writeExport(req: ExportRequest): Promise<number> {
  const locale = req.app.config.locale.language
  // A sibling of the target so the publishing renames stay on one filesystem. mkdtemp mints a name
  // nothing else holds, so this run removes only what it created; a leftover from a killed run is
  // a stray directory and nothing reuses or clears it.
  await mkdir(dirname(req.dir), { recursive: true, mode: PRIVATE_DIRECTORY_MODE })

  const stage = await mkdtemp(`${req.dir}${STAGE_SUFFIX}-`)

  try {
    const counts = await stageTables(stage, req)

    await publish(stage, req)

    const rows = printTableCounts(req.app, counts)

    req.app.out(
      success(
        t(locale, 'cli.dbExportWrote', {
          ...countedTotals(locale, rows, counts.length),
          dir: req.dir,
        })
      )
    )

    return 0
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function stageTables(stage: string, req: ExportRequest): Promise<readonly TableCount[]> {
  const storage = req.app.resolve('storage')
  const dialect = req.app.resolve('dialect')
  const counts: TableCount[] = []

  for (const table of req.tables) {
    const path = join(stage, buildFileName(table.name, req.format))

    counts.push({
      name: table.name,
      rows: await exportTable({ storage, dialect, table, path, format: req.format }),
    })
  }

  return counts
}

// The staged set moves into place only once every table has been written, so a failure while
// reading leaves the target untouched. The renames themselves go one table at a time: a failure in
// them can leave the target holding some new files beside the old ones.
async function publish(stage: string, req: ExportRequest): Promise<void> {
  await ensurePrivateDirectory(req.dir)

  for (const table of req.tables) {
    const name = buildFileName(table.name, req.format)

    await rename(join(stage, name), join(req.dir, name))
  }
}

function buildFileName(table: string, format: ExportFormat): string {
  return `${table}.${format}`
}

interface TableExport {
  readonly storage: Storage
  readonly dialect: Dialect
  readonly table: DbTable
  readonly path: string
  readonly format: ExportFormat
}

async function exportTable(req: TableExport): Promise<number> {
  const handle = await open(req.path, 'w', PRIVATE_FILE_MODE)

  try {
    return await writeRows(handle, req)
  } finally {
    await handle.close()
  }
}

// Keyset paged, never one SELECT: a table is read a page at a time so no export holds a whole one
// in memory, and cursoring on the primary key means a concurrent insert cannot shift a later page
// into skipping or repeating rows the way an OFFSET would.
async function writeRows(handle: FileHandle, req: TableExport): Promise<number> {
  const firstPage = buildPageSql(req.dialect, req.table, { continued: false })
  const laterPage = buildPageSql(req.dialect, req.table, { continued: true })
  let cursor: readonly unknown[] | null = null
  let total = 0

  for (;;) {
    const page = cursor === null ? firstPage : laterPage
    const bounds: readonly unknown[] = cursor === null ? [PAGE_SIZE] : [...cursor, PAGE_SIZE]
    const rows: readonly Row[] = await req.storage.query<Row>(page, bounds)
    const last = rows.at(-1)

    if (last === undefined) {
      return total
    }

    await handle.write(toPageText(rows, req.format, total === 0))
    total += rows.length
    cursor = req.table.pk.map((column) => last[column])

    if (rows.length < PAGE_SIZE) {
      return total
    }
  }
}

// Table and key columns come from the code-owned registry, never from operator input, so
// interpolating them is the argument `persistence/backup.ts` makes for VACUUM INTO. Bounds bind,
// and they bind in textual order because sqlite placeholders carry no index.
function buildPageSql(
  dialect: Dialect,
  table: DbTable,
  page: { readonly continued: boolean }
): string {
  const keys = table.pk.join(', ')
  const after = page.continued ? `WHERE (${keys}) > (${dialect.paramList(table.pk.length)}) ` : ''
  const limit = dialect.param(page.continued ? table.pk.length + 1 : 1)

  return `SELECT * FROM ${table.name} ${after}ORDER BY ${keys} LIMIT ${limit}`
}

// Values go out as stored - nano-USD stays nano-USD, an epoch-ms column stays a number - because
// the only conversion rule available here would be a guess made from a column name.
function toPageText(rows: readonly Row[], format: ExportFormat, first: boolean): string {
  if (format === 'json') {
    return rows.map((row) => `${JSON.stringify(row)}\n`).join('')
  }

  const columns = Object.keys(rows[0] ?? {})
  const body = rows.map((row) => columns.map((name) => toCsvField(row[name])).join(',')).join('\n')

  return first ? `${columns.join(',')}\n${body}\n` : `${body}\n`
}

function toCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)

  return CSV_QUOTE_RE.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
