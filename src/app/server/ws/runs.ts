import type { ServerWebSocket } from 'bun'

import type { ServerFrame } from '@/app/server/wire/socket'
import type { WsData } from '@/app/server/ws/socket'
import type { OperatorMessage } from '@/core/errors'
import type { SessionId } from '@/core/ids'
import { operatorText, toErrorCode } from '@/app/server/http/dispatch'
import { bindLocale, t } from '@/i18n'

/** False when the socket dropped the frame (closed, or its buffer is full): Bun answers 0 then,
 *  -1 for a frame queued behind backpressure, and the byte count otherwise. */
export function send(ws: ServerWebSocket<WsData>, frame: ServerFrame): boolean {
  return ws.send(JSON.stringify(frame)) !== 0
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

/** A run that failed on something the operator can fix (a model key not set): their sentence goes
 *  in an error frame, and the `done` that follows still closes the turn. */
export function sendOperatorFailure(ws: ServerWebSocket<WsData>, operator: OperatorMessage): void {
  const { locale } = ws.data.services

  send(ws, {
    type: 'chat',
    kind: 'error',
    code: 'unavailable',
    message: bindLocale(locale).translate(operator.key, operator.params),
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
