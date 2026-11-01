// The notice log and the results board: what the daemon filed for the operator while no page was
// watching, and what the last commands answered. Wire-only: this folder imports nothing outside it.

import type { WireEvent } from '@/app/server/wire/events'

/** One notice the bell holds. `event` is the wire event exactly as a connected socket was sent it;
 *  `deliveredTo` lists the raw channel ids that also got it, empty for the bell alone. A fill
 *  (`order_filled`) always reads empty: the chat notice a resting exit sends is not recorded here. */
export interface NoticeWire {
  readonly id: string
  readonly createdAt: number
  /** Epoch ms the operator read it; absent while unread. */
  readonly readAt?: number
  readonly deliveredTo: readonly string[]
  readonly event: WireEvent
}

/** GET /v1/notices?before&beforeId&limit, newest first. The next page is
 *  `before=<nextBefore>&beforeId=<nextBeforeId>` (both null when the page is empty); `before` alone
 *  takes only notices strictly older. `needsYou` counts the approvals waiting now plus the unread
 *  `stop_breached` notices. */
export interface NoticesResponse {
  readonly items: readonly NoticeWire[]
  readonly nextBefore: number | null
  readonly nextBeforeId: string | null
  readonly unread: number
  readonly needsYou: number
}

/** POST /v1/notices/read. */
export interface NoticesReadResponse {
  readonly unread: number
}

/** One recent command answer, as the chat got it. */
export interface BoardEntryWire {
  readonly runId: string
  /** The command name. */
  readonly name: string
  readonly channel: string
  readonly finishedAt: number
  /** The command's own description in the daemon's language, or its name when it has none. */
  readonly title: string
  /** The reply text, credential-scrubbed and cut at 4000 characters with a trailing "...". */
  readonly text: string
  /** The tickers the run reported on, in the order first seen. */
  readonly tickers: readonly string[]
}

/** GET /v1/board: the last eight, newest first. */
export interface BoardResponse {
  readonly entries: readonly BoardEntryWire[]
}
