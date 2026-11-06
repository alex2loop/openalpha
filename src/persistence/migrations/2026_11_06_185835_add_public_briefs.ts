import type { MigrationDown, MigrationUp } from '@/persistence/types'

// Every table `up` creates, so `check-migration-rollback` can fail a table added there and
// forgotten here.
const TABLES_TO_DROP = ['public_briefs'] as const

// One row per day of the brief the daemon posts to the public side, and how many times it tried.
// `sections` and `built_at` stay null for a day whose build came back empty, so a failed build is
// throttled like a failed post; `published_at` is null until a post lands.
export const up: MigrationUp = async (tx) => {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS public_briefs (
      day TEXT PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      sections TEXT,
      screens TEXT,
      built_at BIGINT,
      published_at BIGINT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at BIGINT
    )`
  )
}

// The rows are rebuilt from market data by the next run, so they go with the table.
export const down: MigrationDown = async (tx) => {
  for (const table of TABLES_TO_DROP) {
    await tx.execute(`DROP TABLE IF EXISTS ${table}`)
  }
}
