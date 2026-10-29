import type { Dialect, Storage } from '@/core/types/storage'
import type { SessionListing, SessionListQuery } from '@/persistence/types'
import { channelId } from '@/core/channels'
import { ValidationError } from '@/core/errors'
import { agentId, sessionId } from '@/core/ids'
import { toLikeContainsPattern } from '@/persistence/sql/like-escape'
import { shownRow } from '@/persistence/stores/session/shown-rows'

interface ListingDeps {
  readonly db: Storage
  readonly dialect: Dialect
}

interface ListingRow {
  readonly id: string
  readonly agent_id: string
  readonly channel: string
  readonly chat_id: string | null
  readonly started_at: number
  readonly listed_at: number
  readonly turn_count: number
  readonly first_user: string | null
  readonly last_assistant: string | null
}

/** The filters are optional, so the statement is built per call; every value still binds. */
export async function listSessionsByChannels(
  deps: ListingDeps,
  query: SessionListQuery
): Promise<readonly SessionListing[]> {
  if (!Number.isSafeInteger(query.limit) || query.limit <= 0) {
    throw new ValidationError('session list limit must be a positive safe integer')
  }

  if (query.channels?.length === 0) {
    return []
  }

  const params: (string | number)[] = []
  const bind = (value: string | number): string => {
    params.push(value)

    return deps.dialect.param(params.length)
  }
  const conditions = [
    ...buildConditions(query, bind),
    ...(query.before === undefined ? [] : [toBeforeCondition(query.before, query.beforeId, bind)]),
  ]
  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')} `
  // The page is cut first, off the index on when each session was last written in, so the
  // correlated reads below run on its rows alone.
  const sql =
    `SELECT p.id, p.agent_id, p.channel, p.chat_id, p.started_at, p.listed_at, ` +
    `(SELECT COUNT(*) FROM session_messages m WHERE m.session_id = p.id ` +
    `AND m.role = 'user') AS turn_count, ` +
    `(SELECT m.content FROM session_messages m WHERE m.session_id = p.id ` +
    `AND m.role = 'user' ORDER BY m.idx ASC LIMIT 1) AS first_user, ` +
    `(SELECT m.content FROM session_messages m WHERE m.session_id = p.id ` +
    `AND m.role = 'assistant' AND ${shownRow('m')} ORDER BY m.idx DESC LIMIT 1) AS last_assistant ` +
    `FROM (SELECT s.id, s.agent_id, s.channel, s.chat_id, s.started_at, ` +
    `COALESCE(s.last_message_at, s.last_activity_at) AS listed_at FROM sessions s ${where}` +
    `ORDER BY s.last_message_at DESC, s.id DESC LIMIT ${bind(query.limit)}) p ` +
    `ORDER BY p.listed_at DESC, p.id DESC`
  const rows = await deps.db.query<ListingRow>(sql, params)

  return rows.map(toSessionListing)
}

// Every filter the query names, its values bound in order.
function buildConditions(
  query: SessionListQuery,
  bind: (value: string | number) => string
): readonly string[] {
  return [
    // A session nothing shown was said in has nothing to open; one asked for by id is still found.
    ...(query.id === undefined ? ['s.last_message_at IS NOT NULL'] : []),
    ...(query.channels === undefined
      ? []
      : [`s.channel IN (${query.channels.map(bind).join(', ')})`]),
    ...(query.id === undefined ? [] : [`s.id = ${bind(query.id)}`]),
    ...(query.query === undefined
      ? []
      : [
          // Only the rows the page displays can match. Folding is ASCII-only on sqlite and follows
          // the collation on postgres, so the text as typed matches too: "Đầu tư" is found by
          // "Đầu" even where "đầu" misses it.
          `EXISTS (SELECT 1 FROM session_messages m WHERE m.session_id = s.id ` +
            `AND ${shownRow('m')} ` +
            `AND (LOWER(m.content) LIKE ${bind(toLikeContainsPattern(query.query.toLowerCase()))} ESCAPE '\\' ` +
            `OR m.content LIKE ${bind(toLikeContainsPattern(query.query))} ESCAPE '\\'))`,
        ]),
  ]
}

/** Strictly older, and with a cursor id also the sessions of that same instant that sort after it. */
function toBeforeCondition(
  before: number,
  beforeId: string | undefined,
  bind: (value: string | number) => string
): string {
  if (beforeId === undefined) {
    return `s.last_message_at < ${bind(before)}`
  }

  return (
    `(s.last_message_at < ${bind(before)} OR ` +
    `(s.last_message_at = ${bind(before)} AND s.id < ${bind(beforeId)}))`
  )
}

function toSessionListing(row: ListingRow): SessionListing {
  return {
    id: sessionId(row.id),
    agentId: agentId(row.agent_id),
    channel: channelId(row.channel),
    ...(row.chat_id === null ? {} : { chatId: row.chat_id }),
    startedAt: row.started_at,
    lastMessageAt: row.listed_at,
    turnCount: row.turn_count,
    firstUserContent: row.first_user,
    lastAssistantContent: row.last_assistant,
  }
}
