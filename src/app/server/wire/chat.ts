// Chat streaming contract. The daemon relays its already-scrubbed, display-resolved stream over
// /v1/ws as ServerFrames { type:'chat', ...ChatFrame }, terminated by kind:'done' / kind:'error'.
// Scrubbing, tool-display and usage formatting are daemon-side (parity with CLI/Telegram); clients render.

import type { ApiErrorCode } from '@/app/server/wire/errors'

/** Tool display fields, resolved daemon-side — emoji + name + optional detail. */
interface ChatToolDisplay {
  readonly emoji: string
  readonly name: string
  readonly detail?: string
}

/** Names the command a frame belongs to when the command runs in the chat's command lane: the lane
 *  entry id. A frame without one belongs to the session's own turn. */
interface LaneTag {
  readonly id?: string
}

/** One streamed chat content frame. `kind` discriminates; clients ignore an unknown kind rather than
 *  error. `queued` = held behind an in-flight run for the same session, or, with `id` and
 *  `position`, a command waiting in the command lane (`position` is its 1-based place in line). */
export type ChatFrame =
  | ({ readonly kind: 'text'; readonly delta: string } & LaneTag)
  | { readonly kind: 'reasoning'; readonly delta: string }
  | ({ readonly kind: 'tool'; readonly status: 'run'; readonly id: string } & ChatToolDisplay)
  | { readonly kind: 'tool'; readonly status: 'ok' | 'error'; readonly id: string }
  | { readonly kind: 'usage'; readonly header: string; readonly body: string }
  | ({
      readonly kind: 'subagent'
      readonly agentId: string
      readonly depth: number
    } & ChatToolDisplay)
  | {
      readonly kind: 'subagent_model'
      readonly agentId: string
      readonly depth: number
      readonly model: string
    }
  | { readonly kind: 'queued'; readonly id?: string; readonly position?: number }
  /** A lane command left the line and began; `runId` is the run the live feed shows it as. */
  | { readonly kind: 'started'; readonly id: string; readonly runId?: string }
  /** A lane command ended without a result: removed while it waited, or cancelled after it started. */
  | { readonly kind: 'dropped'; readonly id: string }
  /** The running turn took a steer; it reads it at its next turn boundary. */
  | { readonly kind: 'steered' }
  /** No running turn read a steer: the CLI's sentence asking to send it again. */
  | { readonly kind: 'steer_dropped'; readonly text: string }
  /** A long slash command's current step in the operator's words; each replaces the last. */
  | ({ readonly kind: 'progress'; readonly text: string } & LaneTag)

/** The terminal frame `{ type:'chat', kind:'done', reason }`. `reason` is the run result reason, or
 *  'slash' when a leading-`/` message was handled by the dispatcher instead of a run. */
export interface ChatDone extends LaneTag {
  readonly reason: string
  /** The run this answer came from: the command's run, or the agent turn's engine run. */
  readonly runId?: string
  /** The session the answer belongs to, so a client that sent none learns the one it opened. */
  readonly sessionId?: string
  /** Why a halted run stopped, when it carries a code (`budget`, `agent_paused`, ...). Absent on a
   *  completed run. */
  readonly haltCode?: string
  /** What the code alone cannot say: which budget ceiling refused it (`agent_daily_cap`, ...). */
  readonly haltDetail?: string
}

/** Terminal error frame: the contract's stable `code` plus a `message` in the daemon's language. */
export interface ChatError extends LaneTag {
  readonly code: ApiErrorCode
  readonly message: string
}

export type Decision = 'approve' | 'deny' | 'always'

/** POST /v1/respond body: answer one approval. The gate matches on `requestId`. A clarification is
 *  not answered here — its answer is the next chat message in its session. */
export interface RespondBody {
  readonly requestId: string
  readonly decision: Decision
}

/** Chat-input fields. Not a REST route — carried as a `ClientFrame` `{ type:'chat'|'steer', ...ChatBody }`
 *  on /v1/ws. A `/`-prefixed `message` runs the slash dispatcher; `sessionId` continues a thread.
 *  `steer` adds the message to the turn already running; one that cannot take it answers
 *  `steer_dropped`. */
export interface ChatBody {
  readonly message: string
  readonly sessionId?: string
}

/** GET /v1/chat/history/:sessionId — one prior transcript message (display text). */
export interface ChatHistoryMessage {
  readonly role: string
  readonly content: string
}

/** Newest-first page; `?limit=` (default 30) + `?before=<idx>` scroll back. `nextBefore` is the
 *  oldest returned row's transcript `idx`, the next `before`. */
export interface ChatHistoryResponse {
  readonly sessionId: string
  readonly hasMore: boolean
  readonly nextBefore: number | null
  readonly messages: readonly ChatHistoryMessage[]
}

/** GET /v1/chat/recent — id of the most recent app chat session to resume, or null. */
export interface ChatRecentResponse {
  readonly sessionId: string | null
}

/** One conversation as a list shows it. `channel` is where it happened (`api` is this app); only an
 *  `api` session takes a new message, the rest are read-only history. `title` is its first message
 *  and `lastReply` its last answer, each cut short; either is absent when the session has none. */
interface ChatSessionWire {
  readonly sessionId: string
  readonly channel: string
  readonly chatId?: string
  readonly agentId: string
  readonly startedAt: number
  readonly lastActivityAt: number
  readonly messageCount: number
  readonly title?: string
  readonly lastReply?: string
}

/** GET /v1/chat/sessions?channel&query&before&limit — newest activity first. `channel` repeats to
 *  name several and defaults to all. `query` (at least two characters, any case) keeps the sessions
 *  with a message containing it, which may match inside a stored tool call too. `before` is the
 *  `nextBefore` of the page above (a `lastActivityAt`, strictly older); sessions sharing the exact
 *  millisecond across a page edge can be skipped. `nextBefore` is null on the last page. */
export interface ChatSessionsResponse {
  readonly sessions: readonly ChatSessionWire[]
  readonly nextBefore: number | null
}
