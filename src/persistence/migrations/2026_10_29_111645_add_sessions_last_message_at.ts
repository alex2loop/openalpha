import type { MigrationDown, MigrationUp } from '@/persistence/types'

// When the session's newest shown message was written, so the conversation list dates, orders and
// pages by it from an index. Null while nothing shown was said: an operator line, or an answer
// holding text (a turn's tool calls alone hold none). Rows already stored are dated once here.
export const up: MigrationUp = async (tx) => {
  await tx.execute('ALTER TABLE sessions ADD COLUMN last_message_at BIGINT')
  await tx.execute(
    'UPDATE sessions SET last_message_at = (SELECT MAX(m.created_at) FROM session_messages m ' +
      "WHERE m.session_id = sessions.id AND (m.role = 'user' OR (m.role = 'assistant' AND " +
      `(m.content NOT LIKE '[%' OR m.content LIKE '%"type":"text"%'))))`
  )
  await tx.execute(
    'CREATE INDEX IF NOT EXISTS idx_sessions_last_message ON sessions (last_message_at DESC, id DESC)'
  )
}

export const down: MigrationDown = async (tx) => {
  await tx.execute('DROP INDEX IF EXISTS idx_sessions_last_message')
  await tx.execute('ALTER TABLE sessions DROP COLUMN last_message_at')
}
