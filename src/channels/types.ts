import type { ChannelDeliveryConfig } from '@/channels/schema'
import type { ChannelId } from '@/core/channels'
import type { Logger } from '@/core/logging/logger'
import type { PollOffsetStore } from '@/core/types/session'

export type ReactionEmoji = '👀' | '✅' | '❌'

/** The bot message an operator's message replies to. `text` is what the channel shows of it, and
 *  `quote` the part the operator selected. */
export interface InboundReply {
  readonly messageId: string
  readonly text?: string
  readonly quote?: string
}

export interface InboundMessage {
  readonly channel: ChannelId
  readonly chatId: string
  readonly userId: string
  readonly text: string
  readonly messageId: string
  /** Set on a button tap: it files under the keyboard message's `messageId`, so this is what tells
   *  one tap of that keyboard from the next. */
  readonly tapId?: string
  readonly reactionRef?: string
  readonly receivedAt: number
  readonly isGroup?: boolean
  readonly addressedToBot?: boolean
  readonly replyTo?: InboundReply
}

export interface ChannelCallbackQuery {
  readonly channel: ChannelId
  readonly id: string
  readonly data: string
  readonly from: string
  readonly messageId?: string
  readonly chatId?: string
  /** Group callbacks need fail-closed operator checks; a missing value is treated as direct. */
  readonly isGroup?: boolean
}

export interface OutboundButton {
  readonly label: string
  readonly callbackId: string
}

export interface ChannelOutbound {
  readonly channel: ChannelId
  readonly chatId: string
  readonly text: string
  readonly replyToMessageId?: string
  readonly buttons?: readonly OutboundButton[]
  readonly useMarkup?: boolean
  readonly silent?: boolean
}

export interface OutboundTarget {
  readonly channel: ChannelId
  readonly chatId: string
}

export interface SentRef {
  readonly messageId: string
}

export interface EditRequest {
  readonly chatId: string
  readonly messageId: string
  readonly text: string
  /** Re-sent on every edit: a channel that omits them drops the keyboard the message already had. */
  readonly buttons?: readonly OutboundButton[]
  readonly useMarkup?: boolean
  readonly signal?: AbortSignal
}

export interface ReactionRequest {
  readonly chatId: string
  readonly messageId: string
  readonly reactionRef?: string
  // `null` clears every reaction on the message rather than being a no-op.
  readonly emoji: ReactionEmoji | null
}

export interface ChannelCapabilities {
  readonly inlineButtons: boolean
  readonly markdown: 'none' | 'markdownv2'
  readonly typing: boolean
  readonly reactions: boolean
  readonly canEdit: boolean
  readonly maxTextLen: number
}

// `chunk` owns markup encoding, so escaping and length accounting stay in agreement. Escaping
// beforehand encodes twice and reaches the chat as visible backslashes.
export interface ChannelRenderer {
  /** For a fragment that bypasses `chunk`. Never call it on text you are about to chunk. */
  escape(text: string): string
  normalizeTables(text: string): string
  /** Encodes and splits raw message text. */
  chunk(text: string, maxLen: number): string[]
}

export interface ChannelStatus {
  readonly running: boolean
  readonly connected: boolean
  readonly lastError: string | null
  readonly lastStartAt?: number
  readonly lastStopAt?: number
}

export interface AdapterHandlers {
  onMessage(msg: InboundMessage): Promise<void>
  onCallback(query: ChannelCallbackQuery): Promise<void>
  setStatus(next: Partial<ChannelStatus>): void
  /** False for a chat or user no admission rule could ever let in; absent means store everything. */
  canAdmit?(chatId: string, userId: string): boolean
  /** Command menus to publish, narrowest audience last. Absent when the channel has no menu. */
  commandsForMenu?(): readonly ChannelCommandMenu[]
}

/** Who a published menu reaches. Mirrors the gate: no group member is ever an operator. */
export type ChannelMenuAudience =
  | { readonly kind: 'everyone' }
  | { readonly kind: 'directChats' }
  | { readonly kind: 'chats'; readonly chatIds: readonly string[] }

export interface ChannelMenuCommand {
  readonly name: string
  readonly description: string
}

export interface ChannelCommandMenu {
  readonly audience: ChannelMenuAudience
  readonly commands: readonly ChannelMenuCommand[]
}

export interface ChannelAdapter {
  readonly id: ChannelId
  readonly capabilities: ChannelCapabilities
  readonly renderer: ChannelRenderer
  /**
   * Resolves once the channel is UP — credentials verified, handlers armed. It does not stay
   * pending for the life of the channel: the receive loop runs detached and stops on `signal`, so
   * boot can fail fast on a bad token while a mid-life fault only marks the status unhealthy.
   * `signal` ends intake only: `send`, `edit` and the rest keep working after it, until `dispose`.
   */
  start(handlers: AdapterHandlers, signal: AbortSignal): Promise<void>
  send(out: ChannelOutbound, options?: { readonly signal?: AbortSignal }): Promise<SentRef>
  dispose(): Promise<void>
  edit?(req: EditRequest): Promise<void>
  chatAction?(chatId: string, action: 'typing'): Promise<void>
  setReaction?(req: ReactionRequest): Promise<void>
}

export type AdmissionMode = 'allowlist' | 'pairing'

export interface ChannelAdmission {
  readonly mode: AdmissionMode
  readonly allowedIds: readonly string[]
  readonly operatorUserIds: readonly string[]
}

export type InboxStatus = 'pending' | 'processing' | 'completed' | 'failed'
// `lost` means recovery requeued the entry and someone else now owns it: this worker's result is
// no longer the row's outcome and must not be written over the newer claim.
type InboxCompletion = 'completed' | 'lost'
type InboxFailureDisposition = 'retried' | 'dead-lettered' | 'lost'

interface InboxRecoveryCounts {
  readonly requeued: number
  readonly deadLettered: number
}

export interface InboundInboxEntry {
  readonly channel: ChannelId
  readonly updateId: string
  readonly payload: string
  readonly status: InboxStatus
  readonly acceptedAt: number
  readonly startedAt: number | null
  readonly completedAt: number | null
  readonly error: string | null
  /** The encoded final answer a finished run left undelivered; present means never run again. */
  readonly answer: string | null
  /** Claims taken so far, this one included. */
  readonly attemptCount: number
}

export interface InboundInbox {
  accept(input: {
    readonly channel: ChannelId
    readonly updateId: string
    readonly payload: string
    readonly acceptedAt: number
  }): Promise<'accepted' | 'duplicate'>
  /** Takes a lease on up to `limit` entries. `token` identifies this attempt for settlement. */
  claimPending(input: {
    readonly channel: ChannelId
    readonly limit: number
    readonly startedAt: number
    readonly token: string
  }): Promise<readonly InboundInboxEntry[]>
  complete(input: {
    readonly channel: ChannelId
    readonly updateId: string
    readonly completedAt: number
    readonly token: string
  }): Promise<InboxCompletion>
  failAttempt(input: {
    readonly channel: ChannelId
    readonly updateId: string
    readonly token: string
    readonly error: string
    readonly failedAt: number
    readonly maxAttempts: number
    /** Earliest instant the requeued entry may be claimed again; a dead-lettered one ignores it. */
    readonly retryAt: number
    /** Recorded in the same write that returns the entry, so a requeue never exists without it. */
    readonly answer?: string
  }): Promise<InboxFailureDisposition>
  /** Returns a claimed entry to `pending` without spending an attempt. */
  releaseClaim(input: {
    readonly channel: ChannelId
    readonly updateId: string
    readonly token: string
  }): Promise<void>
  /** Pushes the lease deadline of every entry still held under `token` forward. */
  renewClaims(input: {
    readonly channel: ChannelId
    readonly token: string
    readonly renewedAt: number
  }): Promise<void>
  /** Requeues entries whose lease expired. Live claims are left alone — that is the cutoff's job. */
  recoverStalled(input: {
    readonly channel: ChannelId
    readonly error: string
    readonly recoveredAt: number
    readonly maxAttempts: number
    readonly stalledBefore: number
  }): Promise<InboxRecoveryCounts>
}

export interface ChannelContext {
  readonly logger: Logger
  readonly pollOffsets: PollOffsetStore
  /** Durable inbox: poll loops persist normalized events here before advancing the upstream offset. */
  readonly inbox: InboundInbox
  /** Injected, never read from process: adapters resolve token_env against this. */
  readonly env: Record<string, string | undefined>
  /** Resolved [paths].data_dir. An adapter with on-disk state writes here, never under $HOME. */
  readonly dataDir: string
}

// The inbox stores an opaque payload string; the channel that wrote it tags the shape so the drain
// dispatches to the right handler. Kept channel-local so persistence stays channel-agnostic.
export type InboxPayload =
  | { readonly kind: 'message'; readonly msg: InboundMessage }
  | { readonly kind: 'callback'; readonly cq: ChannelCallbackQuery }

export interface ChannelDefinition<T extends ChannelDeliveryConfig = ChannelDeliveryConfig> {
  readonly id: ChannelId
  // Declarative disk plugins may change only these config fields; absence denies every override.
  readonly safeConfigOverrides?: readonly string[]
  /** The hosts its adapter sends to, which `/v1/outbound` lists for a started channel. Absent when
   *  the transport's hosts are not its own to name. */
  readonly apiHosts?: readonly string[]
  // Parses this channel's slice of the untyped `[channels]` config bag.
  resolveConfig(raw: unknown): T
  isEnabled(config: T): boolean
  admission(config: T): ChannelAdmission
  create(config: T, context: ChannelContext): ChannelAdapter
}

export interface ChannelRuntimeSnapshot extends ChannelStatus {
  readonly channel: ChannelId
}

/** `accepted` means this channel's sender call actually completed. `aborted` means the caller's
 *  own signal cancelled the send — not a channel failure, and never worth a retry. `revoked` means
 *  the operator revoked the chat's pairing: nothing was sent, and no retry will change that.
 *  Everything else — no started channel, a full queue, exhausted retries, shutdown — is
 *  `unavailable`. Enqueueing is never acceptance. */
export type AcknowledgedSendResult = 'accepted' | 'unavailable' | 'aborted' | 'revoked'

export interface AcknowledgedSendOptions {
  readonly signal?: AbortSignal
  /** Set only for a reading the operator may reply to; the runtime files the delivered chunks
   *  under it. */
  readonly noticeLabel?: string
}

/** A line meant for the operator alone, at most as often as its owner allows. Null when there is
 *  nothing to say right now. `chat` is the operator's private chat the message came from. */
export interface OperatorNotices {
  take(chat: OutboundTarget): Promise<string | null>
}

export interface ChannelRuntime {
  readonly channelId: ChannelId
  start(): Promise<void>
  dispose(): Promise<void>
  snapshot(): ChannelRuntimeSnapshot
  /** A long-running slash command is in flight, so a restart now would cut it off. */
  isWorking(): boolean
  /** Submits through this channel's own queue — the same one ordinary delivery uses, so rate
   *  limiting and ordering are not duplicated — and resolves only once the send has settled. */
  notify(
    target: OutboundTarget,
    text: string,
    options?: AcknowledgedSendOptions
  ): Promise<AcknowledgedSendResult>
}
