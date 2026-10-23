import type { NoticeWire } from '@/app/server/wire/notices'
import type { NoticeRow } from '@/persistence/api'
import { isPlainRecord } from '@/core/utils/collections'

/** A stored notice as the page reads it. The event was written by this daemon as JSON, so a row
 *  that does not parse back to an event (a table edited by hand) is left out rather than shown
 *  half-formed. */
export function toNoticeWire(row: NoticeRow): NoticeWire | undefined {
  const event = parseEvent(row.event)

  if (event === undefined) {
    return undefined
  }

  return {
    id: row.id,
    createdAt: row.createdAt,
    ...(row.readAt === undefined ? {} : { readAt: row.readAt }),
    deliveredTo: [...row.deliveredTo],
    // why-safe: the daemon wrote this JSON from a WireEvent; the record check above is the only
    // runtime guard a stored row can get without a schema for every kind.
    event: event as unknown as NoticeWire['event'],
  }
}

function parseEvent(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)

    return isPlainRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
