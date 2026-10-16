import type { ServerWebSocket } from 'bun'
import { randomUUID } from 'node:crypto'

import type { WsData, WsServices } from '@/app/server/ws/socket'
import type { SlashDispatcher } from '@/commands/api'
import type { AgentId, SessionId } from '@/core/ids'
import type { SlashContext, SlashResult } from '@/core/types/command'
import type { Locale } from '@/core/types/locale'
import { API_CHANNEL } from '@/app/server/channel'
import { resolveAgentId } from '@/app/server/ws/chat'
import { registerSocketRun, send, unregisterSocketRun } from '@/app/server/ws/runs'
import { renderMessages } from '@/commands/api'
import { RunHalted } from '@/core/errors'
import { LOCAL_USER_ID } from '@/core/ids'
import { bindLocale, t } from '@/i18n'

/** Returns the message to run as a turn, or null when the slash command was terminal. */
export async function runSlash(
  ws: ServerWebSocket<WsData>,
  sessionId: SessionId,
  line: string
): Promise<ChatRunRequest | null> {
  const { services } = ws.data
  const controller = new AbortController()
  const resolved = services.slashDispatcher.resolve(line)
  const longRunning = resolved?.policy.execution !== undefined

  if (longRunning && !registerSocketRun(ws, sessionId, controller)) {
    return null
  }

  const ctx: SlashContext = {
    channel: API_CHANNEL,
    requestId: randomUUID(),
    surface: 'repl',
    userId: LOCAL_USER_ID,
    sessionId,
    // The app has one chat per session, so the session id is also the chat's identity.
    chatId: sessionId,
    role: 'operator',
    locale: services.locale,
    signal: controller.signal,
    args: [],
    progress: (key, params) => {
      if (!controller.signal.aborted) {
        send(ws, {
          type: 'chat',
          kind: 'progress',
          text: bindLocale(services.locale).translate(key, params),
        })
      }
    },
  }

  try {
    const result = longRunning
      ? await services.sessionQueue.enqueue(sessionId, async () => {
          if (controller.signal.aborted) {
            return null
          }

          return dispatchSlash({ services, line, ctx, resolved })
        })
      : await dispatchSlash({ services, line, ctx, resolved })

    // A null result is a queued command aborted before it started.
    if (controller.signal.aborted || result === null) {
      return null
    }

    return handleSlashResult(ws, services.locale, result)
  } catch (err: unknown) {
    if (!(err instanceof RunHalted) || err.code !== 'queue_full') {
      throw err
    }

    send(ws, {
      type: 'chat',
      kind: 'error',
      code: 'unavailable',
      message: t(services.locale, 'errors.queueFull'),
    })

    return null
  } finally {
    if (longRunning) {
      unregisterSocketRun(ws, sessionId, controller)
    }
  }
}

// A command may bill model calls or append its exchange to this session, and both reference the
// row a first agent turn would otherwise create.
async function openSession(services: WsServices, sessionId: SessionId): Promise<void> {
  await services.sessions.create({
    id: sessionId,
    agentId: await resolveAgentId(services, sessionId),
    userId: LOCAL_USER_ID,
    channel: API_CHANNEL,
    chatId: sessionId,
  })
}

async function dispatchSlash(options: {
  readonly services: WsServices
  readonly line: string
  readonly ctx: SlashContext
  readonly resolved: ReturnType<SlashDispatcher['resolve']>
}): ReturnType<SlashDispatcher['dispatch']> {
  const { services, line, ctx, resolved } = options

  if (resolved === null) {
    return services.slashDispatcher.dispatch(line, ctx)
  }

  await openSession(services, ctx.sessionId)

  return services.slashDispatcher.dispatchResolved(resolved, ctx)
}

export interface ChatRunRequest {
  readonly message: string
  readonly agentId?: AgentId
}

/** Sends chat frames for a slash result; returns a turn request when one should run. */
function handleSlashResult(
  ws: ServerWebSocket<WsData>,
  locale: Locale,
  result: SlashResult
): ChatRunRequest | null {
  switch (result.kind) {
    case 'message':
      sendChat(ws, renderMessages(bindLocale(locale), result))
      return null
    case 'text':
      sendChat(ws, result.text)
      return null
    case 'agent':
      return {
        message: result.retryMessage,
        ...(result.agentId === undefined ? {} : { agentId: result.agentId }),
      }
    case 'handled':
      sendSlashDone(ws)
      return null
    default: {
      // Exhaustive — unreachable per SlashResult union.
      const _exhaustive: never = result
      return _exhaustive
    }
  }
}

function sendChat(ws: ServerWebSocket<WsData>, delta: string): void {
  send(ws, { type: 'chat', kind: 'text', delta })
  sendSlashDone(ws)
}

function sendSlashDone(ws: ServerWebSocket<WsData>): void {
  send(ws, { type: 'chat', kind: 'done', reason: 'slash' })
}
