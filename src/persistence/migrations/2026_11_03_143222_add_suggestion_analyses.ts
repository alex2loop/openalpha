import type { MigrationDown, MigrationUp } from '@/persistence/types'

// Every table `up` creates, so `check-migration-rollback` can fail a table added there and
// forgotten here.
const TABLES_TO_DROP = ['suggestion_analyses'] as const

const INDEXES_TO_DROP = ['idx_suggestion_analyses_instrument'] as const

// What an analysis-only run read and argued, kept apart from `suggestions`: it names no verdict,
// size or level, so nothing about it is scored. `evidence_through` is null when no bar series
// reached the run.
export const up: MigrationUp = async (tx) => {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS suggestion_analyses (
      id TEXT PRIMARY KEY,
      market TEXT NOT NULL,
      ticker TEXT NOT NULL,
      at TEXT NOT NULL,
      evidence_through TEXT,
      payload TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )`
  )
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS idx_suggestion_analyses_instrument ON suggestion_analyses (market, ticker, id)'
  )
}

// Analyses are all the table holds and nothing else reads them, so they go with it.
export const down: MigrationDown = async (tx) => {
  for (const index of INDEXES_TO_DROP) {
    await tx.execute(`DROP INDEX IF EXISTS ${index}`)
  }

  for (const table of TABLES_TO_DROP) {
    await tx.execute(`DROP TABLE IF EXISTS ${table}`)
  }
}
