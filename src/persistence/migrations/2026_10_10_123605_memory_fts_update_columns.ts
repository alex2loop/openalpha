import type { DialectName } from '@/core/types/storage'
import type { MigrationDown, MigrationUp } from '@/persistence/types'

// The FTS row mirrors agent_id, user_id, key, value and importance only. Firing on every update
// rewrote the index for a plain `last_accessed_at` touch on each recall. Postgres keeps its search
// vector as a generated column and has no trigger.
const DROP_TRIGGER = 'DROP TRIGGER IF EXISTS memory_kv_after_update'

const MIRROR_BODY = `BEGIN
      DELETE FROM memory_fts
      WHERE agent_id = OLD.agent_id AND user_id = OLD.user_id AND key = OLD.key;
      INSERT INTO memory_fts(agent_id, user_id, key, value, importance)
      VALUES (NEW.agent_id, NEW.user_id, NEW.key, NEW.value, NEW.importance);
    END`

const UP_STATEMENTS: Readonly<Record<DialectName, readonly string[]>> = {
  sqlite: [
    DROP_TRIGGER,
    `CREATE TRIGGER memory_kv_after_update
    AFTER UPDATE OF agent_id, user_id, key, value, importance ON memory_kv ${MIRROR_BODY}`,
  ],
  postgres: [],
}

const DOWN_STATEMENTS: Readonly<Record<DialectName, readonly string[]>> = {
  sqlite: [
    DROP_TRIGGER,
    `CREATE TRIGGER memory_kv_after_update AFTER UPDATE ON memory_kv ${MIRROR_BODY}`,
  ],
  postgres: [],
}

export const up: MigrationUp = async (tx, dialect) => {
  for (const sql of UP_STATEMENTS[dialect.name]) {
    await tx.execute(sql)
  }
}

export const down: MigrationDown = async (tx, dialect) => {
  for (const sql of DOWN_STATEMENTS[dialect.name]) {
    await tx.execute(sql)
  }
}
