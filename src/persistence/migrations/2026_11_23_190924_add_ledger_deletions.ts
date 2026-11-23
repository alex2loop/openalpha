import type { MigrationDown, MigrationUp } from '@/persistence/types'

// Every table `up` creates, so `check-migration-rollback` can fail a table added there and
// forgotten here.
const TABLES_TO_DROP = ['ledger_deletions'] as const

// A hard delete leaves no row for `bookChangeSince` to see, so the delete is recorded here, in the
// transaction that removes the row: one row per instrument, holding the latest deletion instant
// (epoch ms). A cash row names no instrument and is kept under empty `market` and `ticker`.
export const up: MigrationUp = async (tx) => {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS ledger_deletions (
      market TEXT NOT NULL,
      ticker TEXT NOT NULL,
      deleted_at BIGINT NOT NULL,
      PRIMARY KEY (market, ticker)
    )`
  )
}

// Without the rows a deleted row goes unseen again, as before this table existed.
export const down: MigrationDown = async (tx) => {
  for (const table of TABLES_TO_DROP) {
    await tx.execute(`DROP TABLE IF EXISTS ${table}`)
  }
}
