import { z } from 'zod'

import type { ChatSessionsResponse } from '@/app/server/wire/chat'
import type { SessionListing } from '@/persistence/api'
import { scrubCredentials } from '@/core/security/credentials'
import { truncate } from '@/core/utils/text'
import { withoutResearchDepth } from '@/engine/api'

const SESSION_SNIPPET_MAX_CHARS = 200

/** A stored message is a JSON string, or the block array an assistant turn is; only text blocks are
 *  what a reader sees. */
const STORED_CONTENT = z.union([
  z.string(),
  z.array(z.object({ type: z.string(), text: z.string().optional() })),
])

export function toChatSessionsWire(
  listings: readonly SessionListing[],
  limit: number
): ChatSessionsResponse {
  const last = listings.length < limit ? undefined : listings.at(-1)

  return {
    sessions: listings.map(toChatSessionWire),
    nextBefore: last?.lastMessageAt ?? null,
    nextBeforeId: last?.id ?? null,
  }
}

function toChatSessionWire(listing: SessionListing): ChatSessionsResponse['sessions'][number] {
  const title = toSnippet(listing.firstUserContent, withoutResearchDepth)
  const lastReply = toSnippet(listing.lastAssistantContent)

  return {
    sessionId: listing.id,
    channel: listing.channel,
    ...(listing.chatId === undefined ? {} : { chatId: listing.chatId }),
    agentId: listing.agentId,
    startedAt: listing.startedAt,
    lastMessageAt: listing.lastMessageAt,
    turnCount: listing.turnCount,
    ...(title === undefined ? {} : { title }),
    ...(lastReply === undefined ? {} : { lastReply }),
  }
}

/** The text of a stored message, credentials scrubbed and cut short; absent when it holds none.
 *  `tidy` drops what the page shows no reader. */
function toSnippet(
  stored: string | null,
  tidy: (text: string) => string = (text) => text
): string | undefined {
  const text = stored === null ? '' : tidy(scrubCredentials(textOf(stored))).trim()

  return text === '' ? undefined : truncate(text, SESSION_SNIPPET_MAX_CHARS)
}

function textOf(stored: string): string {
  const parsed = STORED_CONTENT.safeParse(parseJson(stored))

  if (!parsed.success) {
    return ''
  }

  return typeof parsed.data === 'string'
    ? parsed.data
    : parsed.data.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('')
}

function parseJson(stored: string): unknown {
  try {
    return JSON.parse(stored)
  } catch {
    // A row written as bare text rather than JSON is its own content.
    return stored
  }
}
