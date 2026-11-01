import type { MigrationDown, MigrationUp } from '@/persistence/types'

// A row kept only so the session's history shows a slash command's turn as the operator saw it.
// The model never reads it back; every row written before it existed is model context (0).
export const up: MigrationUp = async (tx) => {
  await tx.execute(
    'ALTER TABLE session_messages ADD COLUMN display_only INTEGER NOT NULL DEFAULT 0 ' +
      'CHECK (display_only IN (0, 1))'
  )
}

// The previous release reads every row as model context, so the display rows leave with the flag.
export const down: MigrationDown = async (tx) => {
  await tx.execute('DELETE FROM session_messages WHERE display_only = 1')
  await tx.execute('ALTER TABLE session_messages DROP COLUMN display_only')
}
