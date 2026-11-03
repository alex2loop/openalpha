import type { MigrationDown, MigrationUp } from '@/persistence/types'

// Every table `up` creates, so `check-migration-rollback` can fail a table added there and
// forgotten here.
const TABLES_TO_DROP = ['config_overrides'] as const

// What a host that has no config file keeps of the operator's own settings: one JSON payload per
// section. The browser edition stores the model tiers a visitor changed here; nothing else reads it.
export const up: MigrationUp = async (tx) => {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS config_overrides (
      section TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    )`
  )
}

// The overrides are all the table holds, and a host that reads a config file never wrote one.
export const down: MigrationDown = async (tx) => {
  for (const table of TABLES_TO_DROP) {
    await tx.execute(`DROP TABLE IF EXISTS ${table}`)
  }
}
