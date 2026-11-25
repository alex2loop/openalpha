import type { Transaction } from '@/core/types/storage'
import type { MigrationDown, MigrationUp } from '@/persistence/types'

const DROPPED_INDEXES = ['idx_brief_identity', 'idx_brief_latest'] as const

const REGION_INDEXES: readonly string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_brief_identity
    ON brief_snapshots (region, day, authored_locale)`,
  'CREATE INDEX IF NOT EXISTS idx_brief_latest ON brief_snapshots (region, authored_locale, day DESC)',
]

const ORIGINAL_INDEXES: readonly string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_brief_identity
    ON brief_snapshots (day, authored_locale)`,
  'CREATE INDEX IF NOT EXISTS idx_brief_latest ON brief_snapshots (authored_locale, day DESC)',
]

// A snapshot is rebuilt on demand and no row names its region, so the rows go rather than take a
// guessed region. The empty default is only what `ADD COLUMN ... NOT NULL` requires: every write
// names the region.
export const up: MigrationUp = async (tx) => {
  await tx.execute('DELETE FROM brief_snapshots')
  await dropIndexes(tx)
  await tx.execute("ALTER TABLE brief_snapshots ADD COLUMN region TEXT NOT NULL DEFAULT ''")

  for (const sql of REGION_INDEXES) {
    await tx.execute(sql)
  }
}

// Two regions can hold a snapshot for one day and locale, which the original unique index refuses,
// so the rows go again and the next build writes them back.
export const down: MigrationDown = async (tx) => {
  await tx.execute('DELETE FROM brief_snapshots')
  await dropIndexes(tx)
  await tx.execute('ALTER TABLE brief_snapshots DROP COLUMN region')

  for (const sql of ORIGINAL_INDEXES) {
    await tx.execute(sql)
  }
}

async function dropIndexes(tx: Transaction): Promise<void> {
  for (const index of DROPPED_INDEXES) {
    await tx.execute(`DROP INDEX IF EXISTS ${index}`)
  }
}
