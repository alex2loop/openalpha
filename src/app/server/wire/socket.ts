// /v1/ws — the unified WebSocket envelope. One socket: the daemon pushes `wire_event` + chat frames
// (JSON text); the client sends chat/steer/cancel/hello (JSON text). Each text message is a JSON
// object discriminated by `type`; payloads are the contract shapes from the sibling files.

import type { ChatBody, ChatDone, ChatError, ChatFrame } from '@/app/server/wire/chat'
import type { WireEvent } from '@/app/server/wire/events'

/** Bumped only on a breaking change to any wire type (→ a new /v2 surface). Additive changes within
 *  v1 (a new optional field, WireEventKind, or ApiErrorCode) keep this at 1. */
export const CONTRACT_VERSION = 1

/** Server → client. Clients MUST ignore an unknown `type`/`kind` rather than error. */
export type ServerFrame =
  | ({ readonly type: 'wire_event' } & WireEvent)
  | ({ readonly type: 'chat' } & ChatFrame)
  | ({ readonly type: 'chat'; readonly kind: 'done' } & ChatDone)
  | ({ readonly type: 'chat'; readonly kind: 'error' } & ChatError)
  | { readonly type: 'welcome'; readonly contractVersion: number }

/** Client → server. A `chat`/`steer` message starting with `/` runs the slash dispatcher. */
export type ClientFrame =
  | ({ readonly type: 'chat' } & ChatBody)
  | ({ readonly type: 'steer' } & ChatBody)
  | { readonly type: 'cancel'; readonly sessionId: string }
  | { readonly type: 'hello'; readonly contractVersion: number }
