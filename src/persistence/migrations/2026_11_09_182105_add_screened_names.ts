import type { MigrationDown, MigrationUp } from '@/persistence/types'

// Every table `up` creates, so `check-migration-rollback` can fail a table added there and
// forgotten here.
const TABLES_TO_DROP = ['screened_names'] as const

// One row per market: the names its last accounts pass found screened, the session that read them
// and `stamp`, a fingerprint of the stored evidence the screen reads. A later pass reuses the names
// only while both still match, so a restart that changed nothing skips the whole-board read.
export const up: MigrationUp = async (tx) => {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS screened_names (
      market TEXT PRIMARY KEY,
      as_of TEXT NOT NULL,
      stamp TEXT NOT NULL,
      tickers TEXT NOT NULL
    )`
  )
}

// The row is rebuilt by the next accounts pass, which reads the whole board when none is stored.
export const down: MigrationDown = async (tx) => {
  for (const table of TABLES_TO_DROP) {
    await tx.execute(`DROP TABLE IF EXISTS ${table}`)
  }
}
