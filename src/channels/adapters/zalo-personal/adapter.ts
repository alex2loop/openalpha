import type { API, Reactions, ThreadType } from 'zca-js'

import type {
  AdapterHandlers,
  ChannelAdapter,
  ChannelCapabilities,
  ChannelOutbound,
  InboundInbox,
  ReactionEmoji,
  ReactionRequest,
  SentRef,
} from '@/channels/types'
import type { Logger } from '@/core/logging/logger'
import type { LruMap } from '@/core/utils/collections'
import { plainRenderer, stripMarkdown } from '@/channels/renderer'
import { ChannelError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { lruMap } from '@/core/utils/collections'

import type { ProfileLocation } from './credentials'
import { ZALO_PERSONAL_CHANNEL_ID } from './config'
import { runZaloPersonalSession } from './session'
import { createSendThrottle, type SendThrottle } from './throttle'
import { loadZca, type ZcaModule } from './zca'

const ZALO_PERSONAL_MAX_LEN = 2_000
const ZALO_PERSONAL_THREAD_CACHE_MAX = 256
const DISPOSE_SETTLE_MS = 5_000

const ZALO_PERSONAL_CAPABILITIES: ChannelCapabilities = {
  inlineButtons: false,
  markdown: 'none',
  typing: true,
  reactions: true,
  canEdit: false,
  maxTextLen: ZALO_PERSONAL_MAX_LEN,
}

function reactionMap(zca: ZcaModule): Record<ReactionEmoji, Reactions> {
  return {
    '👀': zca.Reactions.WOW,
    '✅': zca.Reactions.LIKE,
    '❌': zca.Reactions.NO,
  }
}

interface CreateZaloPersonalAdapterOptions {
  readonly location: ProfileLocation
  readonly inbox: InboundInbox
  readonly logger: Logger
}

/** The logged-in client with the module it came from, which the sends read their enums from. */
interface ZaloLink {
  readonly api: API
  readonly zca: ZcaModule
}

interface AdapterState {
  link: ZaloLink | null
  sessionTask: Promise<void> | null
  /** Ends the transport the session logs in and sends through. The start signal ends intake only,
   *  so the final notices of a shutdown still go out; `dispose` aborts this. */
  readonly transport: AbortController
  readonly threadTypes: LruMap<string, ThreadType>
  readonly logger: Logger
}

export function createZaloPersonalAdapter(
  options: CreateZaloPersonalAdapterOptions
): ChannelAdapter {
  const state: AdapterState = {
    link: null,
    sessionTask: null,
    transport: new AbortController(),
    threadTypes: lruMap<string, ThreadType>(ZALO_PERSONAL_THREAD_CACHE_MAX),
    logger: options.logger,
  }
  const throttle = createSendThrottle()

  return {
    id: ZALO_PERSONAL_CHANNEL_ID,
    capabilities: ZALO_PERSONAL_CAPABILITIES,
    renderer: plainRenderer,
    start: (handlers, signal) => startSession({ options, state, handlers, signal }),
    send: (out, sendOpts) => sendMessage(state, throttle, { out, ...sendOpts }),
    chatAction: (chatId) => sendTyping(state, throttle, chatId),
    setReaction: (request) => setReaction(state, throttle, request),
    async dispose(): Promise<void> {
      const sessionTask = state.sessionTask

      state.sessionTask = null
      state.link = null
      state.transport.abort()

      try {
        await sessionTask
      } finally {
        state.threadTypes.clear()
        await throttle.settle(DISPOSE_SETTLE_MS)
      }
    },
  }
}

interface StartSessionOptions {
  readonly options: CreateZaloPersonalAdapterOptions
  readonly state: AdapterState
  readonly handlers: AdapterHandlers
  readonly signal: AbortSignal
}

// Logging in happens inside the session loop rather than here, so an account that is not linked
// yet, or a Zalo outage at boot, retries in the background instead of dropping the channel.
async function startSession(input: StartSessionOptions): Promise<void> {
  const { options, state, handlers, signal } = input
  const zca = await loadZca(signal)

  handlers.setStatus({ running: true, connected: false, lastError: null })
  state.sessionTask = runZaloPersonalSession({
    zca,
    location: options.location,
    channelId: ZALO_PERSONAL_CHANNEL_ID,
    handlers,
    inbox: options.inbox,
    logger: options.logger,
    signal,
    transportSignal: state.transport.signal,
    threadTypes: state.threadTypes,
    setApi: (api) => {
      state.link = api === null ? null : { api, zca }
    },
  }).catch((err: unknown) => {
    options.logger.error('zalo_personal.session_terminated', { err: formatErrForLog(err) })
    handlers.setStatus({ running: false, connected: false, lastError: 'session_terminated' })
  })
}

// The cache is filled by pushes, so a chat nobody has posted in since the daemon started (a proactive
// brief, an inbox entry drained after a restart) misses it. Zalo lists the account's groups, so a
// miss asks once and remembers the answer; an id outside that list is a direct thread. A failed
// lookup throws rather than guessing, since a group id sent as a direct thread goes nowhere.
async function resolveThreadType(
  state: AdapterState,
  link: ZaloLink,
  chatId: string
): Promise<ThreadType> {
  const cached = state.threadTypes.get(chatId)

  if (cached !== undefined) {
    return cached
  }

  const { gridVerMap } = await link.api.getAllGroups()
  const { Group, User } = link.zca.ThreadType
  const threadType = Object.hasOwn(gridVerMap, chatId) ? Group : User

  state.threadTypes.set(chatId, threadType)

  return threadType
}

async function sendMessage(
  state: AdapterState,
  throttle: SendThrottle,
  request: { readonly out: ChannelOutbound; readonly signal?: AbortSignal }
): Promise<SentRef> {
  const { out, signal } = request
  const link = state.link

  if (link === null) {
    throw new ChannelError('not_initialized', 'zalo_personal not connected')
  }

  const threadType = await resolveThreadType(state, link, out.chatId)
  const result = await throttle.run(
    () => link.api.sendMessage(stripMarkdown(out.text), out.chatId, threadType),
    signal
  )

  if (!result.message) {
    throw new ChannelError('send_failed', 'zalo_personal_send_failed: no message id returned')
  }

  return { messageId: String(result.message.msgId) }
}

async function sendTyping(
  state: AdapterState,
  throttle: SendThrottle,
  chatId: string
): Promise<void> {
  const link = state.link

  if (link === null) {
    return
  }

  const threadType = await resolveThreadType(state, link, chatId)
  await throttle.run(() => link.api.sendTypingEvent(chatId, threadType))
}

async function setReaction(
  state: AdapterState,
  throttle: SendThrottle,
  request: ReactionRequest
): Promise<void> {
  const cliMsgId = request.reactionRef

  if (cliMsgId === undefined) {
    state.logger.debug('zalo_personal.reaction_skipped', {
      messageId: request.messageId,
      detail: 'missing cliMsgId for reaction',
    })
    return
  }

  const link = state.link

  if (link === null) {
    return
  }

  const threadType = await resolveThreadType(state, link, request.chatId)
  const icon =
    request.emoji === null ? link.zca.Reactions.NONE : reactionMap(link.zca)[request.emoji]

  await throttle.run(() =>
    link.api.addReaction(icon, {
      data: { msgId: request.messageId, cliMsgId },
      threadId: request.chatId,
      type: threadType,
    })
  )
}
