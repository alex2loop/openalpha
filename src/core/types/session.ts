import type { ChannelId } from '@/core/channels'
import type { AgentId, SessionId, UserId } from '@/core/ids'
export type PairingRequestResult =
  | { readonly status: 'created'; readonly code: string; readonly expiresAt: number }
  | { readonly status: 'pending' }
export interface ChatBinding {
  readonly channel: ChannelId
  readonly chatId: string
  readonly agentId: AgentId
  readonly userId: UserId
}

export interface ChatBindingStore {
  get(channel: ChannelId, chatId: string): Promise<ChatBinding | null>
  put(b: ChatBinding): Promise<void>
  remove(channel: ChannelId, chatId: string): Promise<void>
  /** Atomically moves the chat to a fresh session and writes or removes its agent override. */
  selectSession(selection: ChatSessionSelection): Promise<void>
  /** Every binding, newest first. Operator-facing (`agent bindings`); bounded by chat count. */
  list(): Promise<readonly ChatBinding[]>
}

export interface ChatSessionSelection {
  readonly channel: ChannelId
  readonly chatId: string
  readonly userId: UserId
  readonly sessionId: SessionId
  /** Absent means remove the override and use the composition-owned default. */
  readonly agentId?: AgentId
}
export interface SessionQueue {
  enqueue<T>(
    sessionId: SessionId,
    task: () => Promise<T>,
    route?: SessionRouteRegistration
  ): Promise<T>
  /** Pending tasks for a session — 0 when idle. A surface tells the user their message is queued. */
  depth(sessionId: SessionId): number
  /** Rejects work that has not started. The run registry owns aborting active work. */
  cancelSession(sessionId: SessionId): void
  acquireRoute(key: SessionRouteKey): Promise<SessionRouteLease>
  coordinateRoute<T>(key: SessionRouteKey, task: (invalidate: () => void) => Promise<T>): Promise<T>
  /** Serializes chat-global mutations per chat; invalidation stales every chat member's pending work. */
  coordinateChat<T>(key: ChatRouteKey, task: (invalidate: () => void) => Promise<T>): Promise<T>
  /** Shed all new work. One-way: shutdown is the only caller and the process exits after it. */
  pause(): void
}

export interface CommandLaneEntry<T> {
  /** One lane per chat: `toCommandLaneKey`. */
  readonly key: string
  /** Names the entry to `drop`; unique within the lane. */
  readonly id: string
  /** Owned by the lane from here on: released when the task starts, is cancelled, dropped or rejected. */
  readonly registration: SessionRouteRegistration
  readonly task: () => Promise<T>
  /** Called with the 1-based place in the waiting line when the task cannot start at once. */
  readonly onWaiting?: (position: number) => void
}

/** Runs a chat's self-contained commands beside its session turn, a few at a time, instead of one
 *  behind another. A waiting task rejects with `RunHalted('abort')` when cancelled, dropped or its
 *  route went stale, and with `RunHalted('queue_full')` past the waiting cap or after `pause`. */
export interface CommandLane {
  enqueue<T>(entry: CommandLaneEntry<T>): Promise<T>
  /** Rejects every waiting task of the chat; a running task is untouched. */
  cancel(key: string): void
  /** Rejects one waiting task; false when it is not waiting (running, finished or unknown). */
  drop(key: string, id: string): boolean
  /** Shed all new work and reject what waits. One-way: shutdown is the only caller. */
  pause(): void
}

/** Mirrors session scope: user-keyed invalidation never stales another user's pending work. */
export interface SessionRouteKey {
  readonly channel: ChannelId
  readonly chatId: string
  readonly userId: string
}

export interface ChatRouteKey {
  readonly channel: ChannelId
  readonly chatId: string
}

export interface SessionRouteLease {
  register(): SessionRouteRegistration
  release(): void
}

export interface SessionRouteRegistration {
  isCurrent(): boolean
  release(): void
}

export interface PendingPairing {
  readonly code: string
  readonly chatId: string
  /** When the code lapses, epoch ms. */
  readonly expiresAt: number
}

export type PairingApproveResult =
  | { readonly ok: true; readonly chatId: string }
  | { readonly ok: false; readonly reason: 'expired' | 'not_found' }

export interface PairingApproveArgs {
  readonly code: string
  readonly now: number
  readonly channel?: ChannelId
}

export interface PairingDenyArgs {
  readonly code: string
  readonly channel?: ChannelId
}

export interface PairingRevokeArgs {
  readonly channel: ChannelId
  readonly chatId: string
  readonly now: number
}

export interface PairingStore {
  isPaired(channel: ChannelId, chatId: string): Promise<boolean>
  /** The one approved chat on `channel`; undefined when none or several are. */
  lonePairedChat(channel: ChannelId): Promise<string | undefined>
  // Idempotent per chat: re-messaging returns the same code, never a new one.
  requestCode(args: {
    readonly channel: ChannelId
    readonly chatId: string
    readonly now: number
  }): Promise<PairingRequestResult>
  approve(args: PairingApproveArgs): Promise<PairingApproveResult>
  deny(args: PairingDenyArgs): Promise<boolean>
  listPending(channel: ChannelId, now: number): Promise<readonly PendingPairing[]>
  revoke(args: PairingRevokeArgs): Promise<boolean>
  /** True once a chat's pairing was revoked and it has not paired again. A chat that never paired
   *  (a group admitted through its operator) is not revoked. */
  isRevoked(channel: ChannelId, chatId: string): Promise<boolean>
}

export interface SessionKey {
  readonly channel: ChannelId
  readonly chatId: string
  readonly userId: string
}

// The chat's active session id, durable across daemon restarts.
export interface SessionRouter {
  get(key: SessionKey): Promise<SessionId | null>
  getOrCreate(key: SessionKey, candidate: SessionId): Promise<SessionId>
  put(key: SessionKey, sessionId: SessionId): Promise<void>
}

export interface OpenedSession {
  readonly id: SessionId
  readonly agentId: AgentId
  readonly userId: UserId
  readonly channel: ChannelId
  readonly chatId?: string
}

/** Opens — or reactivates — the chat's session row; idempotent on the id. A slash command may bill
 *  model calls to this session and `llm_attempts.session_id` is a foreign key, so the row the first
 *  agent turn would have created has to exist before dispatch, not after it. */
export interface SessionOpener {
  create(session: OpenedSession): Promise<void>
}

export interface SessionActivity {
  /** When the session's newest transcript row was written; null for a session with none. */
  lastMessageAt(id: SessionId): Promise<number | null>
}

export interface PollOffsetStore {
  get(channel: ChannelId): Promise<number | null>
  set(channel: ChannelId, offset: number): Promise<void>
}
