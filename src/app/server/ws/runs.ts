import type { ServerWebSocket } from 'bun'

import type { ServerFrame } from '@/app/server/wire/socket'
import type { WsData } from '@/app/server/ws/socket'
import type { SessionId } from '@/core/ids'
import { operatorText, toErrorCode } from '@/app/server/http/dispatch'
import { t } from '@/i18n'

export function send(ws: ServerWebSocket<WsData>, frame: ServerFrame): void {
  ws.send(JSON.stringify(frame))
}

/** Stable code plus the operator's sentence, never the error's message: a socket is not a log. */
export function sendRunError(ws: ServerWebSocket<WsData>, err: unknown): void {
  const { locale } = ws.data.services

  send(ws, {
    type: 'chat',
    kind: 'error',
    code: toErrorCode(err),
    message: operatorText(locale, err) ?? t(locale, 'errors.unexpected'),
  })
}

export function registerSocketRun(
  ws: ServerWebSocket<WsData>,
  sessionId: SessionId,
  controller: AbortController
): boolean {
  if (ws.data.closed) {
    controller.abort()

    return false
  }

  const controllers = ws.data.activeRuns.get(sessionId)

  if (controllers === undefined) {
    ws.data.activeRuns.set(sessionId, new Set([controller]))

    return true
  }

  controllers.add(controller)

  return true
}

export function unregisterSocketRun(
  ws: ServerWebSocket<WsData>,
  sessionId: SessionId,
  controller: AbortController
): void {
  const controllers = ws.data.activeRuns.get(sessionId)

  if (controllers === undefined) {
    return
  }

  controllers.delete(controller)

  if (controllers.size === 0) {
    ws.data.activeRuns.delete(sessionId)
  }
}

export function abortSocketSession(ws: ServerWebSocket<WsData>, sessionId: SessionId): void {
  for (const controller of ws.data.activeRuns.get(sessionId) ?? []) {
    controller.abort()
  }

  // Session-scoped and chat-scoped: a cancel only reaches the runs this socket's chat started.
  ws.data.services.runControl.abortSession(sessionId, sessionId)
}
