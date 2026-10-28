// The memory contract: what the agents remember, one group per scope (an agent and a user).

/** A preference the operator told in a chat, by its attribute (`style`, `constraints`, ...).
 *  `key` is the stored key, which DELETE takes. */
interface MemoryToldWire {
  readonly key: string
  readonly attribute: string
  readonly value: string
  readonly updatedAt: number
}

/** A note an agent or the operator wrote. `expiresAt` is null for one that never expires. */
interface MemoryNoteWire {
  readonly key: string
  readonly value: string
  readonly updatedAt: number
  readonly expiresAt: number | null
}

/** One scope. `scope` is the stable key DELETE takes, never a list index. `userLabel` names a chat
 *  user ("Telegram 12345", or the raw id when no channel names it); `isLocal` marks the CLI and the
 *  web chat's own user, which a client names itself. */
interface MemoryScopeWire {
  readonly scope: string
  readonly agentId: string
  readonly agentName: string
  readonly userLabel: string
  readonly isLocal: boolean
  readonly told: readonly MemoryToldWire[]
  readonly notes: readonly MemoryNoteWire[]
}

/** `ttlDays` is how long a note lives after its last update; `keyMaxLen` the longest key a write
 *  takes; `truncated` that more rows exist than were sent. */
export interface MemoryResponse {
  readonly scopes: readonly MemoryScopeWire[]
  readonly ttlDays: number
  readonly keyMaxLen: number
  readonly truncated: boolean
}

/** A note for the web chat's scope; `sessionId` names the open chat, whose agent it is written for. */
export interface MemoryWriteBody {
  readonly key: string
  readonly value: string
  readonly sessionId?: string
}

/** `scope` is the key of the scope the note went to, as `MemoryResponse` names it. */
export interface MemoryWriteResult {
  readonly key: string
  readonly scope: string
}

export interface MemoryForgetResult {
  readonly removed: number
}
