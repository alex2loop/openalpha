import type { FinalAnswer } from '@/channels/delivery/answer'
import type { InboundHandlerDeps } from '@/channels/delivery/types'
import type { ChannelCallbackQuery, InboundMessage } from '@/channels/types'
import type { AgentId } from '@/core/ids'
import { COMMAND_CALLBACK_ACTION } from '@/channels/delivery/callbacks'
import { handleControlCallback } from '@/channels/delivery/control'
import { resolveSlashRunRequest, type SlashRunRequest } from '@/channels/delivery/slash'
import { observe } from '@/core/events'
import { agentId as brandAgentId, DEFAULT_AGENT_ID } from '@/core/ids'

import '@/channels/events'

const SLASH_PREFIX = '/'

export interface InboundHandler {
  handleMessage(msg: InboundMessage): Promise<void>
  handleCallback(query: ChannelCallbackQuery): Promise<void>
  /** Sends the final message of a run that finished but could not deliver it. Never runs the agent. */
  redeliver(answer: FinalAnswer): Promise<void>
  dispose(): void
}

interface ResolveRunRequestOptions {
  readonly deps: InboundHandlerDeps
  readonly msg: InboundMessage
  readonly sessionId: Parameters<typeof resolveSlashRunRequest>[0]['sessionId']
  readonly routeLease: Parameters<typeof resolveSlashRunRequest>[0]['route']
}

export function createInboundHandler(deps: InboundHandlerDeps): InboundHandler {
  observe(deps.bus, 'chat_session_reset', {
    signal: deps.signal,
    fn: (event) => {
      if (event.channel === deps.channelId) {
        deps.slashRuns.abortChat(event.chatId)
      }
    },
  })

  return {
    handleMessage: (msg) => route(deps, msg),
    handleCallback: (query) => routeCallback(deps, query),
    redeliver: (answer) => deps.redeliver(answer),
    dispose: () => deps.slashRuns.abortAll(),
  }
}

/** A button tap is untrusted input - a client may send any `callback_data` - so a command payload
 *  re-enters the path a typed message takes rather than reaching a handler directly: the same
 *  admission, the same role gate, the same rate window, the same session. */
async function routeCallback(deps: InboundHandlerDeps, query: ChannelCallbackQuery): Promise<void> {
  const text = commandOf(query)

  if (text === null) {
    await handleControlCallback(deps, query)

    return
  }

  await route(deps, {
    channel: deps.channelId,
    chatId: query.chatId ?? '',
    userId: query.from,
    text,
    messageId: callbackMessageId(query),
    tapId: query.id,
    receivedAt: Date.now(),
    ...(query.isGroup === undefined ? {} : { isGroup: query.isGroup }),
    // A tap is addressed to the bot by construction; it is the bot's own keyboard.
    addressedToBot: true,
  })
}

/** The message id an exchange started by this tap is filed under. */
export function callbackMessageId(query: ChannelCallbackQuery): string {
  return query.messageId ?? query.id
}

/** The command a `cmd:` payload names, or `null` for anything else - including a payload that does
 *  not name a command at all, which a control handler answers for. */
function commandOf(query: ChannelCallbackQuery): string | null {
  if (query.chatId === undefined || !query.data.startsWith(COMMAND_CALLBACK_ACTION)) {
    return null
  }

  const text = query.data.slice(COMMAND_CALLBACK_ACTION.length).trim()

  return text.startsWith(SLASH_PREFIX) ? text : null
}

async function route(deps: InboundHandlerDeps, msg: InboundMessage): Promise<void> {
  if (msg.isGroup && deps.settings.requireMention && !msg.addressedToBot) {
    return
  }

  if (await deps.gate.operatorCommand(msg)) {
    return
  }

  if ((await deps.gate.admit(msg)) !== 'admit') {
    return
  }

  const routeLease = await deps.sessionQueue.acquireRoute({
    channel: deps.channelId,
    chatId: msg.chatId,
    userId: msg.userId,
  })

  try {
    const sessionId = await deps.gate.activeSessionId(msg.chatId, msg.userId)
    const request = await resolveRunRequest({ deps, msg, sessionId, routeLease })

    if (request === null) {
      return
    }

    // A plain message lands in the session's active run at its next turn boundary; only when no
    // run accepts it does it queue as a new exchange. Slash commands always take the queue path.
    if (
      !msg.text.startsWith(SLASH_PREFIX) &&
      deps.runRegistry.steer(sessionId, msg.chatId, request.text)
    ) {
      return
    }

    const selectedAgent = request.agentId ?? (await resolveAgentId(deps, msg.chatId))
    const receipt = deps.queue.enqueueInbound({
      sessionId,
      msg: { ...msg, text: request.text },
      run: (combined) => deps.runExchange({ combined, sessionId, agentId: selectedAgent }),
      route: routeLease.register(),
    })

    routeLease.release()
    await receipt
  } finally {
    routeLease.release()
  }
}

async function resolveRunRequest(
  options: ResolveRunRequestOptions
): Promise<SlashRunRequest | null> {
  const { deps, msg, sessionId, routeLease } = options

  if (!(deps.settings.slashCommands && msg.text.startsWith(SLASH_PREFIX))) {
    return { text: msg.text }
  }

  return resolveSlashRunRequest({
    deps,
    msg,
    sessionId,
    route: routeLease,
    resolveAgentId: (chatId) => resolveAgentId(deps, chatId),
  })
}

async function resolveAgentId(deps: InboundHandlerDeps, chatId: string): Promise<AgentId> {
  const binding = await deps.bindings.get(deps.channelId, chatId)

  if (binding !== null && deps.agents.get(binding.agentId) !== null) {
    return binding.agentId
  }

  if (binding !== null) {
    await deps.bindings.remove(deps.channelId, chatId)
    deps.logger.warn('channel.binding_stale', {
      channel: deps.channelId,
      chatId,
      agentId: binding.agentId,
    })
  }

  return deps.settings.agent ? brandAgentId(deps.settings.agent) : DEFAULT_AGENT_ID
}
