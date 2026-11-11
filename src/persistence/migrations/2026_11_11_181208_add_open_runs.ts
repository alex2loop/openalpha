import type { MigrationDown, MigrationUp } from '@/persistence/types'

const TABLES_TO_DROP = ['open_runs'] as const

// A run the daemon has started and not yet logged as finished, with the columns of its start only.
// A daemon killed mid-run leaves its rows here, so the next boot can log them as interrupted.
export const up: MigrationUp = async (tx) => {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS open_runs (
      run_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('agent', 'command')),
      name TEXT NOT NULL,
      title TEXT,
      agent_id TEXT,
      channel TEXT,
      session_id TEXT,
      parent_run_id TEXT,
      tickers TEXT,
      started_at BIGINT NOT NULL
    )`
  )
}

// Only runs under way live here; the run log keeps every finished one.
export const down: MigrationDown = async (tx) => {
  for (const table of TABLES_TO_DROP) {
    await tx.execute(`DROP TABLE IF EXISTS ${table}`)
  }
}
