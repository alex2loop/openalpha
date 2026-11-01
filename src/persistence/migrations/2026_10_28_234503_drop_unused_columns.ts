import type { MigrationDown, MigrationUp } from '@/persistence/types'

// Columns written and never read back, or never written at all: a notice's weight, wake and run
// live in its stored event, a memory row is never ranked by age or version, and replies follow
// `[locale] language`, not the profile.
const DROPPED_INDEXES = ['idx_memory_user_accessed', 'idx_memory_run'] as const

const DROPPED_COLUMNS: readonly (readonly [table: string, column: string])[] = [
  ['memory_kv', 'source'],
  ['memory_kv', 'run_id'],
  ['memory_kv', 'version'],
  ['memory_kv', 'last_accessed_at'],
  ['notices', 'weight'],
  ['notices', 'wake'],
  ['notices', 'run_id'],
  ['runs', 'chat_id'],
  ['trading_profiles', 'preferred_locale'],
]

// The previous release writes every column again, so each comes back with a default it accepts.
const RESTORED_COLUMNS: readonly string[] = [
  'ALTER TABLE memory_kv ADD COLUMN source TEXT',
  'ALTER TABLE memory_kv ADD COLUMN run_id TEXT',
  'ALTER TABLE memory_kv ADD COLUMN version INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE memory_kv ADD COLUMN last_accessed_at BIGINT NOT NULL DEFAULT 0',
  "ALTER TABLE notices ADD COLUMN weight TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE notices ADD COLUMN wake INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE notices ADD COLUMN run_id TEXT',
  'ALTER TABLE runs ADD COLUMN chat_id TEXT',
  "ALTER TABLE trading_profiles ADD COLUMN preferred_locale TEXT NOT NULL DEFAULT 'en'",
]

const RESTORED_INDEXES: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_memory_user_accessed ON memory_kv (agent_id, user_id, last_accessed_at)',
  'CREATE INDEX IF NOT EXISTS idx_memory_run ON memory_kv (run_id) WHERE run_id IS NOT NULL',
]

export const up: MigrationUp = async (tx) => {
  for (const index of DROPPED_INDEXES) {
    await tx.execute(`DROP INDEX IF EXISTS ${index}`)
  }

  for (const [table, column] of DROPPED_COLUMNS) {
    await tx.execute(`ALTER TABLE ${table} DROP COLUMN ${column}`)
  }
}

export const down: MigrationDown = async (tx) => {
  for (const sql of [...RESTORED_COLUMNS, ...RESTORED_INDEXES]) {
    await tx.execute(sql)
  }
}
