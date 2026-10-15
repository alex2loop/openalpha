import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Dialect, Storage, Transaction } from '@/core/types/storage'
import type { DbTable } from '@/persistence/tables'
import { StorageError } from '@/core/errors'
import { silentLogger } from '@/core/logging/logger'
import { postgresDialect } from '@/persistence/engines/postgres'
import { openSqlite, sqliteDialect } from '@/persistence/engines/sqlite'
import { migrate, MIGRATIONS_TABLE } from '@/persistence/migrations/runner'
import { MIGRATIONS } from '@/persistence/migrations/registry.generated'
import { ALL_TABLES } from '@/persistence/tables'

const DATABASE_FILE = 'table-registry-check.sqlite'
const SQLITE_INTERNAL_PREFIX = 'sqlite_'
const TABLE_NAMES_SQL = `SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name`
const VIRTUAL_TABLE_RE = /^CREATE VIRTUAL TABLE/i
const CREATE_TABLE_NAME_RE = /^CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/i
const COMPOSITE_PK_RE = /PRIMARY KEY\s*\(([^)]+)\)/i
// Anchored per line and barred from crossing one, so the `CREATE TABLE <name> (` header cannot be
// read as the key column of the definition that follows it.
const INLINE_PK_RE = /^\s*([a-z_]+)\s+[^,\n]*?PRIMARY KEY/im

interface MasterRow {
  readonly name: string
  readonly sql: string | null
}

/** `db stats` and `db export` read a hand-written registry because neither engine exposes a portable
 *  catalog query. This migrates a throwaway database and holds that registry against the schema it
 *  claims to describe: a table added to a migration and forgotten here is invisible to both
 *  commands, so it fails at lint speed instead of shipping. */
async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'table-registry-'))
  let db: Storage | undefined

  try {
    db = openSqlite(join(dir, DATABASE_FILE), silentLogger)
    await migrate(db, sqliteDialect, { logger: silentLogger })

    const schema = await readSchemaTables(db)

    assertNamesMatch(schema)
    await assertKeysMatch(db)

    // The live run above proves the registry for sqlite. Postgres cannot be migrated from a gate,
    // so its schema is read from the DDL its own dialect arm would apply. Doing the same for sqlite
    // holds that reader against `PRAGMA table_info`, so a parser that drifts fails here rather than
    // quietly excusing postgres.
    for (const dialect of [sqliteDialect, postgresDialect]) {
      assertDeclaredMatchesRegistry(dialect.name, await readDeclaredTables(dialect))
    }

    process.stdout.write('check-table-registry: PASS\n')
  } finally {
    if (db !== undefined) {
      await db.close()
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** The operator's own tables. Sqlite's bookkeeping, the migration ledger, and an FTS index with its
 *  shadow tables are all derived from what the registry already carries. */
async function readSchemaTables(db: Storage): Promise<readonly string[]> {
  const rows = await db.query<MasterRow>(TABLE_NAMES_SQL)
  const virtual = rows.filter((row) => VIRTUAL_TABLE_RE.test(row.sql ?? '')).map((row) => row.name)

  return rows
    .map((row) => row.name)
    .filter(
      (name) =>
        !name.startsWith(SQLITE_INTERNAL_PREFIX) &&
        name !== MIGRATIONS_TABLE &&
        !virtual.some((owner) => name === owner || name.startsWith(`${owner}_`))
    )
}

function assertNamesMatch(schema: readonly string[]): void {
  const listed = new Set(ALL_TABLES.map((table) => table.name))
  const missing = schema.filter((name) => !listed.has(name))
  const stale = [...listed].filter((name) => !schema.includes(name)).sort()

  assertState(
    missing.length === 0,
    `migrations create tables the registry never names: ${missing.join(', ')} ` +
      `— add each to CORE_TABLES or TRADING_TABLES in persistence/tables.ts`
  )
  assertState(
    stale.length === 0,
    `the registry names tables no migration creates: ${stale.join(', ')}`
  )
}

/** `db export` cursors its pages on the primary key, so a wrong column list either fails the query
 *  outright or silently truncates the export. */
async function assertKeysMatch(db: Storage): Promise<void> {
  for (const table of ALL_TABLES) {
    const actual = await readPrimaryKey(db, table.name)

    assertState(
      actual.length === table.pk.length && actual.every((name, i) => name === table.pk[i]),
      `${table.name} primary key drifted: registry [${table.pk.join(', ')}], schema [${actual.join(', ')}]`
    )
    await assertPageable(db, table)
  }
}

async function readPrimaryKey(db: Storage, table: string): Promise<readonly string[]> {
  const columns = await db.query<{ readonly name: string; readonly pk: number }>(
    `PRAGMA table_info(${table})`
  )

  return columns
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name)
}

/** Column names agreeing is not enough: a keyset page is a row-value comparison, so this runs the
 *  statements `db export` would build from this row. */
async function assertPageable(db: Storage, table: DbTable): Promise<void> {
  const keys = table.pk.join(', ')
  const bounds = sqliteDialect.paramList(table.pk.length)
  const limit = sqliteDialect.param(table.pk.length + 1)

  try {
    await db.query(`SELECT * FROM ${table.name} ORDER BY ${keys} LIMIT ${sqliteDialect.param(1)}`, [
      1,
    ])
    await db.query(
      `SELECT * FROM ${table.name} WHERE (${keys}) > (${bounds}) ORDER BY ${keys} LIMIT ${limit}`,
      [...table.pk.map(() => 0), 1]
    )
  } catch (err: unknown) {
    throw new StorageError(`${table.name} cannot be keyset-paged by db export`, err)
  }
}

/** Runs every migration's `up` against a transaction that records instead of executing, so the DDL
 *  an engine would apply can be read without that engine. */
async function readDeclaredTables(dialect: Dialect): Promise<readonly DbTable[]> {
  const statements: string[] = []
  const recorder: Transaction = {
    query: () => Promise.resolve([]),
    execute: (sql) => {
      statements.push(sql)
      return Promise.resolve({ changes: 0 })
    },
  }

  for (const migration of MIGRATIONS) {
    await migration.up(recorder, dialect)
  }

  const virtual = statements
    .filter((sql) => VIRTUAL_TABLE_RE.test(sql.trim()))
    .flatMap((sql) => parseCreateTable(sql)?.name ?? [])

  return statements
    .flatMap((sql) => parseCreateTable(sql) ?? [])
    .filter((table) => !virtual.some((owner) => table.name.startsWith(owner)))
}

/** A statement's table and primary key, or null when it declares neither — an index, a trigger, or
 *  a virtual table, which carries no key of its own. */
function parseCreateTable(sql: string): DbTable | null {
  const name = CREATE_TABLE_NAME_RE.exec(sql.trim())?.[1]

  if (name === undefined) {
    return null
  }

  const composite = COMPOSITE_PK_RE.exec(sql)

  if (composite?.[1] !== undefined) {
    return { name, pk: composite[1].split(',').map((column) => column.trim()) }
  }

  const inline = INLINE_PK_RE.exec(sql)

  return inline?.[1] === undefined ? null : { name, pk: [inline[1]] }
}

function assertDeclaredMatchesRegistry(engine: string, declared: readonly DbTable[]): void {
  const listed = new Map(ALL_TABLES.map((table) => [table.name, table.pk]))

  for (const table of declared) {
    const pk = listed.get(table.name)

    assertState(pk !== undefined, `${engine} creates ${table.name}, which the registry never names`)
    assertState(
      pk !== undefined && pk.length === table.pk.length && pk.every((c, i) => c === table.pk[i]),
      `${table.name} primary key differs on ${engine}: registry [${pk?.join(', ')}], schema [${table.pk.join(', ')}]`
    )
  }

  const names = new Set(declared.map((table) => table.name))
  const absent = [...listed.keys()].filter((name) => !names.has(name)).sort()

  assertState(absent.length === 0, `${engine} never creates: ${absent.join(', ')}`)
}

function assertState(condition: boolean, message: string): void {
  if (!condition) {
    throw new StorageError(`table registry check failed: ${message}`)
  }
}

await main()
