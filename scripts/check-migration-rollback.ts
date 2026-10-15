import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Storage } from '@/core/types/storage'
import type { Migration } from '@/persistence/types'
import { StorageError } from '@/core/errors'
import { silentLogger } from '@/core/logging/logger'
import { openSqlite, sqliteDialect } from '@/persistence/engines/sqlite'
import { MIGRATIONS } from '@/persistence/migrations/registry.generated'
import {
  migrate,
  resolveMigrationRollback,
  rollbackMigration,
} from '@/persistence/migrations/runner'

const APPLIED_AT_MS = 1
const CORE_TABLE = 'sessions'
const DATABASE_FILE = 'rollback-check.sqlite'
const EXTENSION_MIGRATION_ID = '9999_12_31_235959_rollback_failure_probe'
const EXTENSION_TABLE = 'rollback_failure_probe'
const ANSWER_MIGRATION_ID = '2026_10_11_101208_add_channel_inbox_answer'
const FTS_MIGRATION_ID = '2026_10_10_123605_memory_fts_update_columns'
const INITIAL_MIGRATION_ID = '2026_07_10_000001_initial_schema'
const ORPHAN_MIGRATION_ID = '9999_12_31_235958_removed_extension'
const TRADING_MIGRATION_ID = '2026_07_10_000002_trading_tables'
const TRADING_TABLE = 'ledger_entries'
const MIGRATIONS_DIR = 'src/persistence/migrations'
const CREATE_TABLE_RE = /CREATE TABLE IF NOT EXISTS ([a-z_]+)/g
const RUNTIME_SRC = 'src'
/** DDL a migration composes from a module beside it. Following the import is what keeps the
 *  coverage below exact after a migration is split on size. */
const ALIAS_IMPORT_RE = /^import\s[^']*from\s'@\/([\w./-]+)'/gm
const DROP_LIST_RE = /const TABLES_TO_DROP = \[([\s\S]*?)\] as const/
const QUOTED_RE = /'([a-z_]+)'/g

/** The live round trip below proves `down` undoes `up` on the schema as it stands today. This
 *  proves it will still be true tomorrow: a table added to `up` and forgotten in the drop list fails
 *  here at lint speed, without a database. */
async function assertDownCoversUp(file: string): Promise<void> {
  const source = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
  const list = DROP_LIST_RE.exec(source)

  if (list?.[1] === undefined) {
    return
  }

  const ddl = [source, ...(await importedSources(source))].join('\n')
  const created = new Set([...ddl.matchAll(CREATE_TABLE_RE)].map((match) => match[1]))
  const dropped = new Set([...list[1].matchAll(QUOTED_RE)].map((match) => match[1]))
  const missing = [...created].filter((table) => !dropped.has(table)).sort()
  const stale = [...dropped].filter((table) => !created.has(table)).sort()

  assertState(missing.length === 0, `${file} creates but never drops: ${missing.join(', ')}`)
  assertState(stale.length === 0, `${file} drops tables it never creates: ${stale.join(', ')}`)
}

/** Every `@/`-aliased module the migration imports, read as text. A module that no longer exists is
 *  a type error long before this runs, so an unreadable one is a gate bug rather than a state to
 *  tolerate silently. */
async function importedSources(source: string): Promise<readonly string[]> {
  const specifiers = [...source.matchAll(ALIAS_IMPORT_RE)].flatMap((match) => match[1] ?? [])

  return await Promise.all(
    specifiers.map((specifier) => readFile(join(RUNTIME_SRC, `${specifier}.ts`), 'utf8'))
  )
}

function assertState(condition: boolean, message: string): void {
  if (!condition) {
    throw new StorageError(`migration rollback check failed: ${message}`)
  }
}

async function updateTriggerSql(db: Storage): Promise<string> {
  const rows = await db.query<{ readonly sql: string }>(
    'SELECT sql FROM sqlite_master WHERE type = ?1 AND name = ?2',
    ['trigger', 'memory_kv_after_update']
  )
  return rows[0]?.sql ?? ''
}

async function hasInboxAnswer(db: Storage): Promise<boolean> {
  const rows = await db.query<{ readonly name: string }>(
    'SELECT name FROM pragma_table_info(?1) WHERE name = ?2',
    ['channel_inbox', 'answer']
  )
  return rows.length === 1
}

async function hasTable(db: Storage, table: string): Promise<boolean> {
  const rows = await db.query<{ readonly name: string }>(
    'SELECT name FROM sqlite_master WHERE type = ?1 AND name = ?2',
    ['table', table]
  )
  return rows.length === 1
}

const failingExtension: Migration = {
  id: EXTENSION_MIGRATION_ID,
  reversibility: 'reversible',
  up: async (tx) => {
    await tx.execute(`CREATE TABLE ${EXTENSION_TABLE} (id TEXT PRIMARY KEY)`)
  },
  down: async (tx) => {
    await tx.execute(`DROP TABLE ${EXTENSION_TABLE}`)
    throw new StorageError('intentional rollback probe')
  },
}

async function main(): Promise<void> {
  await assertDownCoversUp(`${TRADING_MIGRATION_ID}.ts`)

  const dir = await mkdtemp(join(tmpdir(), 'migration-rollback-'))
  let db: Storage | undefined

  try {
    db = openSqlite(join(dir, DATABASE_FILE), silentLogger)

    const applied = await migrate(db, sqliteDialect, { logger: silentLogger })
    assertState(applied === MIGRATIONS.length, 'fresh up did not apply every built-in migration')

    assertState(await hasInboxAnswer(db), 'answer migration did not add the inbox column')
    const answerRolledBack = await rollbackMigration(db, sqliteDialect, {
      expectedId: ANSWER_MIGRATION_ID,
      logger: silentLogger,
    })
    assertState(answerRolledBack.kind === 'rolled_back', 'answer rollback did not complete')
    assertState(!(await hasInboxAnswer(db)), 'answer rollback retained the inbox column')

    assertState(
      (await updateTriggerSql(db)).includes('UPDATE OF'),
      'fts migration did not narrow the update trigger'
    )
    const ftsRolledBack = await rollbackMigration(db, sqliteDialect, {
      expectedId: FTS_MIGRATION_ID,
      logger: silentLogger,
    })
    assertState(ftsRolledBack.kind === 'rolled_back', 'fts rollback did not complete')
    assertState(
      !(await updateTriggerSql(db)).includes('UPDATE OF'),
      'fts rollback did not restore the original update trigger'
    )

    const ready = await resolveMigrationRollback(db, sqliteDialect)
    assertState(
      ready.kind === 'ready' && ready.id === TRADING_MIGRATION_ID,
      'trading migration was not the latest rollback candidate'
    )

    const rolledBack = await rollbackMigration(db, sqliteDialect, {
      expectedId: TRADING_MIGRATION_ID,
      logger: silentLogger,
    })
    assertState(rolledBack.kind === 'rolled_back', 'trading rollback did not complete')
    assertState(await hasTable(db, CORE_TABLE), 'rollback removed a core table')
    assertState(!(await hasTable(db, TRADING_TABLE)), 'rollback retained a trading table')

    const floor = await resolveMigrationRollback(db, sqliteDialect)
    assertState(
      floor.kind === 'irreversible' && floor.id === INITIAL_MIGRATION_ID,
      'initial migration did not block rollback'
    )

    assertState((await migrate(db, sqliteDialect, { logger: silentLogger })) === 3, 're-up failed')
    assertState(await hasTable(db, TRADING_TABLE), 're-up did not restore trading schema')

    await db.execute('INSERT INTO _migrations (id, applied_at) VALUES (?1, ?2)', [
      ORPHAN_MIGRATION_ID,
      APPLIED_AT_MS,
    ])
    const orphan = await resolveMigrationRollback(db, sqliteDialect)
    assertState(orphan.kind === 'orphan', 'orphaned history did not block rollback')
    await db.execute('DELETE FROM _migrations WHERE id = ?1', [ORPHAN_MIGRATION_ID])

    await db.execute('DELETE FROM _migrations WHERE id = ?1', [INITIAL_MIGRATION_ID])
    const gap = await resolveMigrationRollback(db, sqliteDialect)
    assertState(gap.kind === 'gap' && gap.id === INITIAL_MIGRATION_ID, 'gap was not detected')
    await db.execute('INSERT INTO _migrations (id, applied_at) VALUES (?1, ?2)', [
      INITIAL_MIGRATION_ID,
      APPLIED_AT_MS,
    ])

    const expected = await resolveMigrationRollback(db, sqliteDialect)
    assertState(expected.kind === 'ready', 'race probe had no candidate')
    await db.execute('DELETE FROM _migrations WHERE id = ?1', [TRADING_MIGRATION_ID])
    const changed = await rollbackMigration(db, sqliteDialect, {
      expectedId: TRADING_MIGRATION_ID,
      logger: silentLogger,
    })
    assertState(changed.kind === 'history_changed', 'changed history was not refused')
    await migrate(db, sqliteDialect, { logger: silentLogger })

    await migrate(db, sqliteDialect, {
      logger: silentLogger,
      migrations: [failingExtension],
    })
    let rollbackFailed = false

    try {
      await rollbackMigration(db, sqliteDialect, {
        expectedId: EXTENSION_MIGRATION_ID,
        logger: silentLogger,
        migrations: [failingExtension],
      })
    } catch (err: unknown) {
      assertState(err instanceof StorageError, 'failing down escaped as an unexpected error type')
      rollbackFailed = true
    }

    assertState(rollbackFailed, 'failing down unexpectedly completed')
    assertState(await hasTable(db, EXTENSION_TABLE), 'failed down did not restore its table')
    const afterFailure = await resolveMigrationRollback(db, sqliteDialect, [failingExtension])
    assertState(
      afterFailure.kind === 'ready' && afterFailure.id === EXTENSION_MIGRATION_ID,
      'failed down removed its ledger row'
    )

    process.stdout.write('check-migration-rollback: PASS\n')
  } finally {
    if (db !== undefined) {
      await db.close()
    }
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

await main()
