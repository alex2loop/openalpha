import type { MigrationDown, MigrationUp } from '@/persistence/types'

// Every table `up` creates, so `check-migration-rollback` can fail a table added there and
// forgotten here.
const TABLES_TO_DROP = ['notices'] as const

const INDEXES_TO_DROP = ['idx_notices_created_at'] as const

export const up: MigrationUp = async (tx) => {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS notices (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      weight TEXT NOT NULL,
      wake INTEGER NOT NULL,
      run_id TEXT,
      delivered_to TEXT NOT NULL,
      event TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      read_at BIGINT
    )`
  )
  await tx.execute('CREATE INDEX IF NOT EXISTS idx_notices_created_at ON notices (created_at)')
}

// The notice log is history the daemon wrote about itself; nothing else reads it, so it goes with the table.
export const down: MigrationDown = async (tx) => {
  for (const index of INDEXES_TO_DROP) {
    await tx.execute(`DROP INDEX IF EXISTS ${index}`)
  }

  for (const table of TABLES_TO_DROP) {
    await tx.execute(`DROP TABLE IF EXISTS ${table}`)
  }
}
