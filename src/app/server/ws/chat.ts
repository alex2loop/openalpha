import type { ServerWebSocket } from 'bun'
import { randomUUID } from 'node:crypto'

import type { ChatFrame } from '@/app/server/wire/chat'
import type { ChatRunRequest } from '@/app/server/ws/slash'
import type { WsData, WsServices } from '@/app/server/ws/socket'
import type { AgentId, SessionId } from '@/core/ids'
import { API_CHANNEL } from '@/app/server/channel'
import {
  registerSocketRun,
  send,
  sendOperatorFailure,
  sendRunError,
  unregisterSocketRun,
} from '@/app/server/ws/runs'
import { createChatFrameMapper } from '@/app/server/ws/stream-events'
import { sessionId as brandSessionId, DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'

const CHAT_ID_RE = /^chat_[0-9a-f]{26}$/
const CHAT_ID_HEX_LEN = 26

export async function runChat(
  ws: ServerWebSocket<WsData>,
  sessionId: SessionId,
  request: ChatRunRequest
): Promise<void> {
  if (ws.data.closed) {
    return
  }

  const { services } = ws.data
  const controller = new AbortController()

  if (!registerSocketRun(ws, sessionId, controller)) {
    return
  }

  try {
    const agentId = request.agentId ?? (await resolveAgentId(services, sessionId))

    if (controller.signal.aborted || ws.data.closed) {
      return
    }

    // The session is busy (an earlier turn, or one awaiting approval): say so rather than go quiet.
    if (services.sessionQueue.depth(sessionId) > 0) {
      send(ws, { type: 'chat', kind: 'queued' })
    }

    const result = await services.sessionQueue.enqueue(sessionId, async () => {
      if (controller.signal.aborted) {
        return null
      }

      const frames = createChatFrameMapper()

      try {
        return await services.runner.run(
          {
            agentId,
            sessionId,
            userId: LOCAL_USER_ID,
            channel: API_CHANNEL,
            userMessage: request.message,
            onChunk: (event) => sendChatFrames(ws, frames.map(event)),
          },
          { chatId: sessionId, parentSignal: controller.signal }
        )
      } finally {
        sendChatFrames(ws, frames.flush())
      }
    })

    if (controller.signal.aborted || result === null) {
      return
    }

    if (result.operator !== undefined) {
      sendOperatorFailure(ws, result.operator)
    }

    send(ws, {
      type: 'chat',
      kind: 'done',
      reason: result.reason,
      ...(result.haltCode === undefined ? {} : { haltCode: result.haltCode }),
      ...(result.haltDetail === undefined ? {} : { haltDetail: result.haltDetail }),
    })
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      return
    }

    services.logger.error('api.ws-chat-failed', { err: formatErrForLog(err) })
    sendRunError(ws, err)
  } finally {
    unregisterSocketRun(ws, sessionId, controller)
  }
}

function sendChatFrames(ws: ServerWebSocket<WsData>, frames: readonly ChatFrame[]): void {
  for (const frame of frames) {
    send(ws, { type: 'chat', ...frame })
  }
}

export async function resolveAgentId(services: WsServices, session: SessionId): Promise<AgentId> {
  const binding = await services.bindings.get(API_CHANNEL, session)

  return binding !== null && services.agents.has(binding.agentId)
    ? binding.agentId
    : DEFAULT_AGENT_ID
}

/** A client-supplied id is honoured only if it matches the server-minted shape; else mint a fresh one. */
export function resolveSessionId(provided: string | undefined): SessionId {
  return brandSessionId(
    provided !== undefined && CHAT_ID_RE.test(provided) ? provided : createChatId()
  )
}

function createChatId(): string {
  return `chat_${randomUUID().replaceAll('-', '').slice(0, CHAT_ID_HEX_LEN)}`
}
