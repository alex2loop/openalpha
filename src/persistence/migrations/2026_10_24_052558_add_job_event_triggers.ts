import type { MigrationDown, MigrationUp } from '@/persistence/types'

// Every table `up` creates, so `check-migration-rollback` can fail a table added there and
// forgotten here. Fires go first: they reference the job like the trigger does.
const TABLES_TO_DROP = ['job_event_fires', 'job_event_triggers'] as const

export const up: MigrationUp = async (tx) => {
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS job_event_triggers (
      job_id TEXT PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
      event TEXT NOT NULL CHECK (event IN ('stop', 'target', 'price', 'mover')),
      market TEXT,
      ticker TEXT,
      condition TEXT,
      threshold DOUBLE PRECISION,
      alert_id TEXT,
      cooldown_ms BIGINT NOT NULL CHECK (cooldown_ms >= 0),
      created_at BIGINT NOT NULL
    )`
  )
  await tx.execute(
    `CREATE TABLE IF NOT EXISTS job_event_fires (
      job_id TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
      fire_key TEXT NOT NULL,
      last_fired_at BIGINT NOT NULL,
      PRIMARY KEY (job_id, fire_key)
    )`
  )
}

// A job with a trigger is a parked event job: once its trigger is gone it would read as a `once`
// job due in the year 275760, so the jobs go with the tables.
export const down: MigrationDown = async (tx) => {
  await tx.execute('DELETE FROM jobs WHERE id IN (SELECT job_id FROM job_event_triggers)')

  for (const table of TABLES_TO_DROP) {
    await tx.execute(`DROP TABLE IF EXISTS ${table}`)
  }
}
