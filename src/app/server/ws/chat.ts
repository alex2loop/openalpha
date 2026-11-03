import type { ChatFrame, LaneTag } from '@/app/server/wire/chat'
import type { FrameSink } from '@/app/server/ws/frame-sink'
import type { ChatClient, ChatLink } from '@/app/server/ws/runs'
import type { WsServices } from '@/app/server/ws/services'
import type { ChatRunRequest } from '@/app/server/ws/slash'
import type { AgentId, RunId, SessionId } from '@/core/ids'
import type { RunResult } from '@/engine/api'
import { API_CHANNEL } from '@/app/server/channel'
import { CHAT_ID_RE, createChatId } from '@/app/server/chat-id'
import {
  followRunId,
  registerRun,
  sendOperatorFailure,
  sendRunError,
  toLaneTag,
  toTurnTag,
  unregisterRun,
} from '@/app/server/ws/runs'
import { createChatFrameMapper } from '@/app/server/ws/stream-events'
import { sessionId as brandSessionId, DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { isEntryAgent } from '@/engine/api'

export async function runChat(
  request: ChatRunRequest,
  sink: FrameSink,
  client: ChatClient
): Promise<void> {
  if (sink.closed) {
    return
  }

  const link: ChatLink = { sink, client }
  const { sessionId } = request
  const { services } = client
  const controller = new AbortController()

  if (!registerRun(link, sessionId, controller)) {
    return
  }

  try {
    const agentId = request.agentId ?? (await resolveAgentId(services, sessionId))

    if (controller.signal.aborted || sink.closed) {
      return
    }

    // The session is busy (an earlier turn, or one awaiting approval): say so rather than go quiet.
    if (services.sessionQueue.depth(sessionId) > 0) {
      sink.send({ type: 'chat', kind: 'queued', ...toTurnTag(request.id, sessionId) })
    }

    const turn = await services.sessionQueue.enqueue(sessionId, () =>
      runTurn({ link, agentId, request, controller })
    )

    if (controller.signal.aborted || turn === null) {
      return
    }

    sendTurnEnd(link, { ...turn, sessionId, tag: toLaneTag(request.id) })
  } catch (err: unknown) {
    if (controller.signal.aborted) {
      return
    }

    services.logger.error('api.ws_chat_failed', { err: formatErrForLog(err) })
    sendRunError(link, err, request.id)
  } finally {
    unregisterRun(client, sessionId, controller)
  }
}

interface TurnInput {
  readonly link: ChatLink
  readonly agentId: AgentId
  readonly request: ChatRunRequest
  readonly controller: AbortController
}

interface TurnOutcome {
  readonly result: RunResult
  readonly runId: RunId | undefined
}

/** A turn's end, with the session it ran in and the tag its frames carry. */
interface TurnEnd extends TurnOutcome {
  readonly sessionId: SessionId
  readonly tag: LaneTag
}

/** The turn at the head of its session; null when it was stopped before it started. */
async function runTurn(input: TurnInput): Promise<TurnOutcome | null> {
  const { link, agentId, request, controller } = input
  const { sessionId } = request
  const { services } = link.client

  if (controller.signal.aborted) {
    return null
  }

  const frames = createChatFrameMapper()
  const follow = followRunId(services.bus, sessionId)
  const tag = toLaneTag(request.id)

  // A tagged message hears its session as its turn begins, before any answer.
  if (request.id !== undefined) {
    link.sink.send({ type: 'chat', kind: 'started', id: request.id, sessionId })
  }

  try {
    const result = await services.runner.run(
      {
        agentId,
        sessionId,
        userId: LOCAL_USER_ID,
        channel: API_CHANNEL,
        userMessage: request.message,
        onChunk: (event) => sendChatFrames(link.sink, frames.map(event), tag),
      },
      { chatId: sessionId, parentSignal: controller.signal }
    )

    return { result, runId: follow.current() }
  } finally {
    follow.stop()
    sendChatFrames(link.sink, frames.flush(), tag)
  }
}

function sendTurnEnd(link: ChatLink, turn: TurnEnd): void {
  const { result, runId, sessionId, tag } = turn

  if (result.operator !== undefined) {
    sendOperatorFailure(link, result.operator, tag)
  }

  link.sink.send({
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
function sendChatFrames(sink: FrameSink, frames: readonly ChatFrame[], tag: LaneTag): void {
  for (const frame of frames) {
    sink.send(
      frame.kind === 'tool' ? { type: 'chat', ...frame } : { type: 'chat', ...frame, ...tag }
    )
  }
}

export async function resolveAgentId(services: WsServices, session: SessionId): Promise<AgentId> {
  const binding = await services.bindings.get(API_CHANNEL, session)

  return binding !== null && isEntryAgent(services.agents.get(binding.agentId))
    ? binding.agentId
    : DEFAULT_AGENT_ID
}

/** A client-supplied id is honoured only if it matches the server-minted shape; else mint a fresh one. */
export function resolveSessionId(provided: string | undefined): SessionId {
  return brandSessionId(
    provided !== undefined && CHAT_ID_RE.test(provided) ? provided : createChatId()
  )
}
