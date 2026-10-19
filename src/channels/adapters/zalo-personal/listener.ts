import type { API, GroupMessage, Message } from 'zca-js'
import { CloseReason, ThreadType } from 'zca-js'

import type { AdapterHandlers, InboundInbox, InboundReply, InboxPayload } from '@/channels/types'
import type { ChannelId } from '@/core/channels'
import type { Logger } from '@/core/logging/logger'
import type { LruMap } from '@/core/utils/collections'
import { acceptInbound } from '@/channels/delivery/inbox-accept'
import { formatErrForLog } from '@/core/security/credentials'
import { settleWithin } from '@/core/utils/concurrency'
import { sleep } from '@/core/utils/time'

const ACCEPT_QUEUE_MAX = 256
const ACCEPT_MAX_ATTEMPTS = 3
const ACCEPT_RETRY_BASE_MS = 500
const ACCEPT_OUTAGE_RETRY_MS = 30_000
const ACCEPT_SETTLE_TIMEOUT_MS = 5_000
const MENTION_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g
const ABORTED_CLOSE: ListenerClose = { code: CloseReason.ManualClosure, reason: 'aborted' }

interface AttachListenerOptions {
  readonly api: API
  readonly threadTypes: LruMap<string, ThreadType>
  readonly handlers: AdapterHandlers
  readonly inbox: InboundInbox
  readonly logger: Logger
  readonly signal: AbortSignal
  readonly botName: string
  readonly channelId: ChannelId
}

interface ListenerClose {
  readonly code: number
  readonly reason: string
}

interface ZaloPersonalListener {
  /** Settles once the socket closes for good, or the signal aborts. Never rejects. */
  readonly closed: Promise<ListenerClose>
  dispose(): Promise<void>
}

interface MentionContext {
  readonly ownId: string
  readonly pattern: RegExp
}

interface PendingAccept {
  readonly updateId: string
  readonly payload: InboxPayload
  readonly acceptedAt: number
}

interface AcceptQueue {
  push(updateId: string, payload: InboxPayload): void
  settle(): Promise<void>
}

interface AcceptContext {
  readonly listener: AttachListenerOptions
  readonly accepts: AcceptQueue
  readonly mention: MentionContext
}

export async function resolveBotName(api: API): Promise<string> {
  try {
    const info = await api.fetchAccountInfo()
    return info.profile.displayName || api.getOwnId()
  } catch {
    return api.getOwnId()
  }
}

// zca-js's own reconnect is left off: it re-dials the same session and can fire after stop(), so the
// session loop owns reconnecting, with a fresh login each time.
export function attachZaloPersonalListener(options: AttachListenerOptions): ZaloPersonalListener {
  const { api, handlers, logger, signal } = options

  if (signal.aborted) {
    return { closed: Promise.resolve(ABORTED_CLOSE), dispose: () => Promise.resolve() }
  }

  const accepts = createAcceptQueue(options)
  const context: AcceptContext = {
    listener: options,
    accepts,
    mention: { ownId: api.getOwnId(), pattern: buildMentionPattern(options.botName) },
  }
  const { promise: closed, resolve: settleClosed } = Promise.withResolvers<ListenerClose>()
  const onMessage = (message: Message): void => acceptPushedMessage(context, message)
  const onConnected = (): void => handlers.setStatus({ connected: true, lastError: null })
  const onError = (err: unknown): void => {
    logger.warn('zalo_personal.listener_error', { err: formatErrForLog(err) })
  }
  const onClosed = (code: number, reason: string): void => settleClosed({ code, reason })
  const onAbort = (): void => settleClosed(ABORTED_CLOSE)
  let detached = false
  const detach = (): void => {
    if (detached) {
      return
    }

    detached = true
    signal.removeEventListener('abort', onAbort)
    clean(logger, () => api.listener.off('message', onMessage))
    clean(logger, () => api.listener.off('connected', onConnected))
    clean(logger, () => api.listener.off('error', onError))
    clean(logger, () => api.listener.off('closed', onClosed))
    clean(logger, () => api.listener.stop())
  }

  try {
    api.listener.on('message', onMessage)
    api.listener.on('connected', onConnected)
    api.listener.on('error', onError)
    api.listener.on('closed', onClosed)
    signal.addEventListener('abort', onAbort, { once: true })
    api.listener.start({ retryOnClose: false })
  } catch (err: unknown) {
    detach()
    throw err
  }

  return {
    closed,
    dispose: () => {
      detach()
      return accepts.settle()
    },
  }
}

// Push events land in the durable inbox like poll updates: deduped by message id, dispatched by
// the drain with retries and dead-lettering. The push callback is synchronous with no offset to
// hold back, so a persistence failure is absorbed by the bounded retry queue instead. A message no
// admission rule could let in is dropped first, so a stranger cannot grow the inbox.
function acceptPushedMessage(context: AcceptContext, message: Message): void {
  const inbound = toInboundMessage(message, context.mention, context.listener.channelId)

  if (
    inbound === undefined ||
    context.listener.handlers.canAdmit?.(inbound.chatId, inbound.userId) === false
  ) {
    return
  }

  context.listener.threadTypes.set(message.threadId, message.type)
  context.accepts.push(inbound.messageId, { kind: 'message', msg: inbound })
}

interface AcceptQueueState {
  readonly options: AttachListenerOptions
  readonly queue: PendingAccept[]
  draining: Promise<void> | null
  redrainTimer: ReturnType<typeof setTimeout> | null
  settling: boolean
  dropWarned: boolean
}

// Single-flight so inbox writes keep arrival order; bounded so a long storage outage cannot grow
// the backlog without limit. Full queue drops the oldest waiting message. An outage that outlasts
// the retry window keeps the head message and redrains later; only shutdown drops terminally,
// because there is no upstream replay to hand back to.
function createAcceptQueue(options: AttachListenerOptions): AcceptQueue {
  const state: AcceptQueueState = {
    options,
    queue: [],
    draining: null,
    redrainTimer: null,
    settling: false,
    dropWarned: false,
  }

  return {
    push: (updateId, payload) => pushAccept(state, updateId, payload),
    settle: () => settleAccepts(state),
  }
}

function pushAccept(state: AcceptQueueState, updateId: string, payload: InboxPayload): void {
  if (state.queue.length >= ACCEPT_QUEUE_MAX) {
    state.queue.shift()

    if (!state.dropWarned) {
      state.options.logger.warn('zalo_personal.inbox_backlog_dropped', {
        queueMax: ACCEPT_QUEUE_MAX,
      })
      state.dropWarned = true
    }
  }

  state.queue.push({ updateId, payload, acceptedAt: Date.now() })

  if (state.redrainTimer === null) {
    kickAccepts(state)
  }
}

async function settleAccepts(state: AcceptQueueState): Promise<void> {
  state.settling = true
  if (state.redrainTimer !== null) {
    clearTimeout(state.redrainTimer)
    state.redrainTimer = null
  }
  kickAccepts(state)

  if (state.draining === null) {
    return
  }

  if (!(await settleWithin(state.draining, ACCEPT_SETTLE_TIMEOUT_MS))) {
    state.options.logger.warn('zalo_personal.inbox_drain_timeout', { pending: state.queue.length })
  }
}

function kickAccepts(state: AcceptQueueState): void {
  state.draining ??= drainAccepts(state).finally(() => {
    state.draining = null

    if (state.redrainTimer === null && state.queue.length > 0) {
      kickAccepts(state)
    }
  })
}

async function drainAccepts(state: AcceptQueueState): Promise<void> {
  const { options, queue } = state

  // Shifted before the write so a concurrent overflow drop can only ever remove waiting items.
  for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
    const result = await persistWithRetry(options, item)

    if (result.persisted) {
      state.dropWarned = false
      continue
    }

    if (options.signal.aborted || state.settling) {
      options.logger.error('zalo_personal.inbox_accept_failed', {
        messageId: item.updateId,
        err: formatErrForLog(result.err),
      })
      continue
    }

    queue.unshift(item)
    options.logger.warn('zalo_personal.inbox_accept_retrying', {
      messageId: item.updateId,
      pending: queue.length,
      err: formatErrForLog(result.err),
    })
    scheduleRedrain(state)
    return
  }
}

function scheduleRedrain(state: AcceptQueueState): void {
  if (state.settling || state.redrainTimer !== null) {
    return
  }

  state.redrainTimer = setTimeout(() => {
    state.redrainTimer = null
    kickAccepts(state)
  }, ACCEPT_OUTAGE_RETRY_MS)
  state.redrainTimer.unref()
}

type PersistResult =
  | { readonly persisted: true }
  | { readonly persisted: false; readonly err: unknown }

async function persistWithRetry(
  options: AttachListenerOptions,
  item: PendingAccept
): Promise<PersistResult> {
  const { inbox, channelId, signal } = options

  for (let attempt = 1; ; attempt += 1) {
    try {
      await acceptInbound({ inbox, channel: channelId, ...item })
      return { persisted: true }
    } catch (err: unknown) {
      if (attempt >= ACCEPT_MAX_ATTEMPTS || signal.aborted) {
        return { persisted: false, err }
      }

      try {
        await sleep(ACCEPT_RETRY_BASE_MS * 2 ** (attempt - 1), signal)
      } catch {
        // Aborted mid-backoff: the next failure is terminal under the aborted signal.
      }
    }
  }
}

function clean(logger: Logger, cleanup: () => void): void {
  try {
    cleanup()
  } catch (err: unknown) {
    logger.warn('zalo_personal.listener_cleanup_failed', { err: formatErrForLog(err) })
  }
}

function toInboundMessage(message: Message, mention: MentionContext, channelId: ChannelId) {
  if (message.isSelf) {
    return undefined
  }

  const text = typeof message.data.content === 'string' ? message.data.content : ''

  if (text === '') {
    return undefined
  }

  const isGroup = message.type === ThreadType.Group
  const receivedAtMs = Number.parseInt(message.data.ts, 10)
  const replyTo = isGroup ? undefined : toReplyTo(message, mention)

  return {
    channel: channelId,
    chatId: message.threadId,
    userId: message.data.uidFrom || message.threadId,
    text,
    messageId: message.data.msgId,
    receivedAt: Number.isFinite(receivedAtMs) ? receivedAtMs : Date.now(),
    ...(typeof message.data.cliMsgId === 'string' && message.data.cliMsgId !== ''
      ? { reactionRef: message.data.cliMsgId }
      : {}),
    isGroup,
    addressedToBot: isGroup ? isAddressedToBot(message, mention, text) : true,
    ...(replyTo === undefined ? {} : { replyTo }),
  }
}

// Direct chats only, for the same reason as Telegram: sent messages are remembered per chat, so a
// group reply could pull another member's answer into this session. `globalMsgId` is the replied
// message's `msgId`, which is what `send` returns and the sent-message map records.
function toReplyTo(message: Message, mention: MentionContext): InboundReply | undefined {
  const { quote } = message.data

  if (quote === undefined || quote.ownerId !== mention.ownId) {
    return undefined
  }

  return {
    messageId: String(quote.globalMsgId),
    ...(typeof quote.msg === 'string' && quote.msg !== '' ? { text: quote.msg } : {}),
  }
}

// Structured mentions carry verified identity; the text pattern is the fallback when the push
// carries none.
function isAddressedToBot(message: GroupMessage, mention: MentionContext, text: string): boolean {
  const mentions = message.data.mentions

  if (mentions !== undefined) {
    return mentions.some((entry) => entry.uid === mention.ownId)
  }
  return mention.pattern.test(text)
}

// `@Alpha` must not fire on `@AlphaResearch`, and case must not gate invocation.
function buildMentionPattern(botName: string): RegExp {
  const escaped = botName.replace(MENTION_ESCAPE_RE, '\\$&')

  return new RegExp(`@${escaped}(?![\\p{L}\\p{N}_])`, 'iu')
}
