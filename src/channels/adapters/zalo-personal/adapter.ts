import type { API } from 'zca-js'
import { Reactions, ThreadType } from 'zca-js'

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

const REACTION_MAP: Record<ReactionEmoji, Reactions> = {
  '👀': Reactions.WOW,
  '✅': Reactions.LIKE,
  '❌': Reactions.NO,
}

interface CreateZaloPersonalAdapterOptions {
  readonly location: ProfileLocation
  readonly inbox: InboundInbox
  readonly logger: Logger
}

interface AdapterState {
  api: API | null
  sessionTask: Promise<void> | null
  readonly threadTypes: LruMap<string, ThreadType>
  readonly logger: Logger
}

export function createZaloPersonalAdapter(
  options: CreateZaloPersonalAdapterOptions
): ChannelAdapter {
  const state: AdapterState = {
    api: null,
    sessionTask: null,
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
      state.api = null

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
function startSession(input: StartSessionOptions): Promise<void> {
  const { options, state, handlers, signal } = input

  handlers.setStatus({ running: true, connected: false, lastError: null })
  state.sessionTask = runZaloPersonalSession({
    location: options.location,
    channelId: ZALO_PERSONAL_CHANNEL_ID,
    handlers,
    inbox: options.inbox,
    logger: options.logger,
    signal,
    threadTypes: state.threadTypes,
    setApi: (api) => {
      state.api = api
    },
  }).catch((err: unknown) => {
    options.logger.error('zalo_personal.session_terminated', { err: formatErrForLog(err) })
    handlers.setStatus({ running: false, connected: false, lastError: 'session_terminated' })
  })

  return Promise.resolve()
}

// The cache is filled by pushes, so a chat nobody has posted in since the daemon started (a proactive
// brief, an inbox entry drained after a restart) misses it. Zalo lists the account's groups, so a
// miss asks once and remembers the answer; an id outside that list is a direct thread. A failed
// lookup throws rather than guessing, since a group id sent as a direct thread goes nowhere.
async function resolveThreadType(
  state: AdapterState,
  api: API,
  chatId: string
): Promise<ThreadType> {
  const cached = state.threadTypes.get(chatId)

  if (cached !== undefined) {
    return cached
  }

  const { gridVerMap } = await api.getAllGroups()
  const threadType = Object.hasOwn(gridVerMap, chatId) ? ThreadType.Group : ThreadType.User

  state.threadTypes.set(chatId, threadType)

  return threadType
}

async function sendMessage(
  state: AdapterState,
  throttle: SendThrottle,
  request: { readonly out: ChannelOutbound; readonly signal?: AbortSignal }
): Promise<SentRef> {
  const { out, signal } = request
  const api = state.api

  if (api === null) {
    throw new ChannelError('not_initialized', 'zalo_personal not connected')
  }

  const threadType = await resolveThreadType(state, api, out.chatId)
  const result = await throttle.run(
    () => api.sendMessage(stripMarkdown(out.text), out.chatId, threadType),
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
  const api = state.api

  if (api === null) {
    return
  }

  const threadType = await resolveThreadType(state, api, chatId)
  await throttle.run(() => api.sendTypingEvent(chatId, threadType))
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

  const api = state.api

  if (api === null) {
    return
  }

  const threadType = await resolveThreadType(state, api, request.chatId)
  const icon = request.emoji === null ? Reactions.NONE : REACTION_MAP[request.emoji]

  await throttle.run(() =>
    api.addReaction(icon, {
      data: { msgId: request.messageId, cliMsgId },
      threadId: request.chatId,
      type: threadType,
    })
  )
}
