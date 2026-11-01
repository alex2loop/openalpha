import { randomUUID } from 'node:crypto'

const CHAT_ID_HEX_LEN = 26

/** The shape of a session id this app mints for a chat it opens. */
export const CHAT_ID_RE = new RegExp(`^chat_[0-9a-f]{${CHAT_ID_HEX_LEN}}$`)

export function createChatId(): string {
  return `chat_${randomUUID().replaceAll('-', '').slice(0, CHAT_ID_HEX_LEN)}`
}
