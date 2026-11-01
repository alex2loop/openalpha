import type { MigrationDown, MigrationUp } from '@/persistence/types'

// Every table `up` creates, so `check-migration-rollback` can fail a table added there and
// forgotten here.
const TABLES_TO_DROP = ['runs'] as const

// `llm_attempts` is read by run: the cost of a run is the sum of its attempts and of every
// descendant's, walked through `parent_run_id`. Neither column was indexed before this reader.
const INDEXES_TO_DROP = [
  'idx_runs_ended_at',
  'idx_runs_parent_run',
  'idx_llm_attempts_run',
  'idx_llm_attempts_parent_run',
] as const

export const up: MigrationUp = async (tx) => {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('agent', 'command')),
      name TEXT NOT NULL,
      title TEXT,
      summary TEXT,
      agent_id TEXT,
      channel TEXT,
      chat_id TEXT,
      session_id TEXT,
      parent_run_id TEXT,
      sources INTEGER,
      started_at BIGINT NOT NULL,
      ended_at BIGINT NOT NULL,
      outcome TEXT NOT NULL
    )`
  )
  await tx.execute('CREATE INDEX IF NOT EXISTS idx_runs_ended_at ON runs (ended_at)')
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS idx_runs_parent_run ON runs (parent_run_id) ' +
      'WHERE parent_run_id IS NOT NULL'
  )
  await tx.execute('CREATE INDEX IF NOT EXISTS idx_llm_attempts_run ON llm_attempts (run_id)')
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS idx_llm_attempts_parent_run ON llm_attempts (parent_run_id) ' +
      'WHERE parent_run_id IS NOT NULL'
  )
}

// The run log is history the daemon wrote about itself; nothing else reads it, so it goes with the table.
export const down: MigrationDown = async (tx) => {
  for (const index of INDEXES_TO_DROP) {
    await tx.execute(`DROP INDEX IF EXISTS ${index}`)
  }

  for (const table of TABLES_TO_DROP) {
    await tx.execute(`DROP TABLE IF EXISTS ${table}`)
  }
}
