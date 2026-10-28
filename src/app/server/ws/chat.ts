import type { ServerWebSocket } from 'bun'

import type { ChatFrame, LaneTag } from '@/app/server/wire/chat'
import type { ChatRunRequest } from '@/app/server/ws/slash'
import type { WsData, WsServices } from '@/app/server/ws/socket'
import type { AgentId, RunId, SessionId } from '@/core/ids'
import type { RunResult } from '@/engine/api'
import { API_CHANNEL } from '@/app/server/channel'
import { CHAT_ID_RE, createChatId } from '@/app/server/chat-id'
import {
  followRunId,
  registerSocketRun,
  send,
  sendOperatorFailure,
  sendRunError,
  toLaneTag,
  toTurnTag,
  unregisterSocketRun,
} from '@/app/server/ws/runs'
import { createChatFrameMapper } from '@/app/server/ws/stream-events'
import { sessionId as brandSessionId, DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'

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
      send(ws, { type: 'chat', kind: 'queued', ...toTurnTag(request.id, sessionId) })
    }

    const turn = await services.sessionQueue.enqueue(sessionId, () =>
      runTurn({ ws, sessionId, agentId, request, controller })
    )

    if (controller.signal.aborted || turn === null) {
      return
    }

    sendTurnEnd(ws, sessionId, { ...turn, tag: toLaneTag(request.id) })
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      return
    }

    services.logger.error('api.ws_chat_failed', { err: formatErrForLog(err) })
    sendRunError(ws, err, request.id)
  } finally {
    unregisterSocketRun(ws, sessionId, controller)
  }
}

interface TurnInput {
  readonly ws: ServerWebSocket<WsData>
  readonly sessionId: SessionId
  readonly agentId: AgentId
  readonly request: ChatRunRequest
  readonly controller: AbortController
}

interface TurnOutcome {
  readonly result: RunResult
  readonly runId: RunId | undefined
}

/** A turn's end, with the tag its frames carry. */
interface TurnEnd extends TurnOutcome {
  readonly tag: LaneTag
}

/** The turn at the head of its session; null when it was stopped before it started. */
async function runTurn(input: TurnInput): Promise<TurnOutcome | null> {
  const { ws, sessionId, agentId, request, controller } = input
  const { services } = ws.data

  if (controller.signal.aborted) {
    return null
  }

  const frames = createChatFrameMapper()
  const link = followRunId(services.bus, sessionId)
  const tag = toLaneTag(request.id)

  // A tagged message hears its session as its turn begins, before any answer.
  if (request.id !== undefined) {
    send(ws, { type: 'chat', kind: 'started', id: request.id, sessionId })
  }

  try {
    const result = await services.runner.run(
      {
        agentId,
        sessionId,
        userId: LOCAL_USER_ID,
        channel: API_CHANNEL,
        userMessage: request.message,
        onChunk: (event) => sendChatFrames(ws, frames.map(event), tag),
      },
      { chatId: sessionId, parentSignal: controller.signal }
    )

    return { result, runId: link.current() }
  } finally {
    link.stop()
    sendChatFrames(ws, frames.flush(), tag)
  }
}

function sendTurnEnd(ws: ServerWebSocket<WsData>, sessionId: SessionId, turn: TurnEnd): void {
  const { result, runId, tag } = turn

  if (result.operator !== undefined) {
    sendOperatorFailure(ws, result.operator, tag)
  }

  send(ws, {
    type: 'chat',
    kind: 'done',
    reason: result.reason,
    sessionId,
    ...tag,
    ...(runId === undefined ? {} : { runId }),
    ...(result.haltCode === undefined ? {} : { haltCode: result.haltCode }),
    ...(result.haltDetail === undefined ? {} : { haltDetail: result.haltDetail }),
  })
}

// A tool frame's `id` is its tool call's, so it keeps it and carries no tag.
function sendChatFrames(
  ws: ServerWebSocket<WsData>,
  frames: readonly ChatFrame[],
  tag: LaneTag
): void {
  for (const frame of frames) {
    send(
      ws,
      frame.kind === 'tool' ? { type: 'chat', ...frame } : { type: 'chat', ...frame, ...tag }
    )
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
