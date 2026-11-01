import type { Transaction } from '@/core/types/storage'

// A block array starts with `[`; one holding no text block is a turn's tool calls alone.
const BLOCKS_PREFIX = '[%'
const TEXT_BLOCK = '%"type":"text"%'

/** The stored rows the conversation page shows: the operator's lines, and every answer but one that
 *  only called tools. `isShownMessage` decides the same of a row being written. */
export function shownRow(alias: string): string {
  return (
    `(${alias}.role = 'user' OR (${alias}.role = 'assistant' AND ` +
    `(${alias}.content NOT LIKE '${BLOCKS_PREFIX}' OR ${alias}.content LIKE '${TEXT_BLOCK}')))`
  )
}

/** Dates each session its rows show but nothing stamped: rows read back from an export taken
 *  before sessions carried `last_message_at`. */
export async function stampLastMessages(tx: Transaction): Promise<void> {
  await tx.execute(
    'UPDATE sessions SET last_message_at = (SELECT MAX(m.created_at) FROM session_messages m ' +
      `WHERE m.session_id = sessions.id AND ${shownRow('m')}) WHERE last_message_at IS NULL`
  )
}
