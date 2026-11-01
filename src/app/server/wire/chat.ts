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

/** Names the message a frame answers. A `chat` frame sent with an `id` has it echoed on every frame
 *  it produces (a command in the lane uses it as its lane id). For a message sent without one, it
 *  names the lane entry of a command in the chat's command lane, and a frame without one belongs to
 *  the session's own turn. */
export interface LaneTag {
  readonly id?: string
}

/** One streamed chat content frame. `kind` discriminates; clients ignore an unknown kind rather than
 *  error. `queued` = held behind an in-flight run for the same session, or, with `id` and
 *  `position`, a command waiting in the command lane (`position` is its 1-based place in line). */
export type ChatFrame =
  | ({ readonly kind: 'text'; readonly delta: string } & LaneTag)
  | ({ readonly kind: 'reasoning'; readonly delta: string } & LaneTag)
  /** `id` here is the tool call's own id, never the message's. */
  | ({ readonly kind: 'tool'; readonly status: 'run'; readonly id: string } & ChatToolDisplay)
  | { readonly kind: 'tool'; readonly status: 'ok' | 'error'; readonly id: string }
  | ({ readonly kind: 'usage'; readonly header: string; readonly body: string } & LaneTag)
  | ({
      readonly kind: 'subagent'
      readonly agentId: string
      readonly depth: number
    } & ChatToolDisplay &
      LaneTag)
  | ({
      readonly kind: 'subagent_model'
      readonly agentId: string
      readonly depth: number
      readonly model: string
    } & LaneTag)
  /** `sessionId` rides with a message sent with an `id`, so a client knows a new session at once. */
  | {
      readonly kind: 'queued'
      readonly id?: string
      readonly position?: number
      readonly sessionId?: string
    }
  /** A lane command left the line and began; `runId` is the run the live feed shows it as. A
   *  message sent with an `id` that becomes an agent turn also starts, with its `sessionId`. */
  | {
      readonly kind: 'started'
      readonly id: string
      readonly runId?: string
      readonly sessionId?: string
    }
  /** A lane command ended without a result: removed while it waited, or cancelled after it started. */
  | { readonly kind: 'dropped'; readonly id: string }
  /** The running turn took a steer; it reads it at its next turn boundary. */
  | ({ readonly kind: 'steered' } & LaneTag)
  /** No running turn read a steer: the CLI's sentence asking to send it again. */
  | ({ readonly kind: 'steer_dropped'; readonly text: string } & LaneTag)
  /** A long slash command's current step in the operator's words; each replaces the last. */
  | ({ readonly kind: 'progress'; readonly text: string } & LaneTag)
  /** `/new` moved the chat of `sessionId` to a session of its own: a client that names its session
   *  in every message leaves this one, so its next message opens the new one. */
  | { readonly kind: 'reset'; readonly sessionId: string }

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
  /** The client's own id for this message, echoed on every frame it produces (`LaneTag`): at most
   *  `CHAT_CLIENT_ID_MAX` letters, digits, `-` or `_`. */
  readonly id?: string
  /** A long-running command a page button sent, whose result the page shows where it was pressed:
   *  no answer frames and no transcript row, only `done`, or `error` carrying the answer of a
   *  command refused before it ran. Any other line ignores it. */
  readonly quiet?: true
}

export const CHAT_CLIENT_ID_MAX = 64

/** GET /v1/chat/history/:sessionId — one prior transcript message (display text). A slash
 *  command's turn is its line (`user`, starting with `/`) and its answer, as the chat showed them. */
export interface ChatHistoryMessage {
  /** Its place in the session's transcript, rising: a client reading the newest page again takes
   *  only the rows past the last one it holds. */
  readonly idx: number
  readonly role: string
  readonly content: string
  /** On an answer: the run that wrote it (an agent turn's run, or a long-running command's), whose
   *  model calls `GET /v1/runs/:id/calls` lists. Absent on the operator's own lines. */
  readonly runId?: string
}

/** Page oldest-first, the newest page first; `?limit=` (default 30) + `?before=<idx>` scroll back. `nextBefore` is the
 *  oldest returned row's transcript `idx`, the next `before`. */
export interface ChatHistoryResponse {
  readonly sessionId: string
  readonly hasMore: boolean
  readonly nextBefore: number | null
  readonly messages: readonly ChatHistoryMessage[]
}

/** GET /v1/chat/recent — id of the most recent app chat session to resume, or null. `agentId` is
 *  the operator's own agent that session talks to; absent when it talks to the assistant. */
export interface ChatRecentResponse {
  readonly sessionId: string | null
  readonly agentId?: string
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
  /** When its newest shown message was written; the list is ordered and paged by it. */
  readonly lastMessageAt: number
  /** The operator's lines, each with the answer it got. */
  readonly turnCount: number
  /** The operator may delete it here: a chat the app or the terminal started. */
  readonly deletable: boolean
  readonly title?: string
  readonly lastReply?: string
}

/** GET /v1/chat/sessions?channel&query&sessionId&before&beforeId&limit — newest message first.
 *  `channel` repeats to name several and defaults to all. `query` (at least two characters, any
 *  case) keeps the sessions with a message containing it, which may match inside a stored tool call
 *  too. `sessionId` keeps that one session, none when it is unknown. The next page is
 *  `before=<nextBefore>&beforeId=<nextBeforeId>` (both null on the last page); `before` alone takes
 *  only sessions strictly older. */
export interface ChatSessionsResponse {
  readonly sessions: readonly ChatSessionWire[]
  readonly nextBefore: number | null
  readonly nextBeforeId: string | null
}

/** DELETE /v1/chat/sessions/:id — false when the session was already gone. */
export interface ChatSessionDeletedWire {
  readonly deleted: boolean
}
