import type { MigrationDown, MigrationUp } from '@/persistence/types'

// Every table `up` creates, so `check-migration-rollback` can fail a table added there and
// forgotten here.
const TABLES_TO_DROP = ['browser_sessions'] as const

const INDEXES_TO_DROP = ['idx_browser_sessions_last_seen_at'] as const

export const up: MigrationUp = async (tx) => {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS browser_sessions (
      id TEXT PRIMARY KEY,
      secret_hash TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      last_seen_at BIGINT NOT NULL
    )`
  )
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS idx_browser_sessions_last_seen_at ON browser_sessions (last_seen_at)'
  )
}

// A lost browser session costs one more `web` sign-in, so the rows go with the table.
export const down: MigrationDown = async (tx) => {
  for (const index of INDEXES_TO_DROP) {
    await tx.execute(`DROP INDEX IF EXISTS ${index}`)
  }

  for (const table of TABLES_TO_DROP) {
    await tx.execute(`DROP TABLE IF EXISTS ${table}`)
  }
}
