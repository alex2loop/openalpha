import type { ServerWebSocket } from 'bun'

import type { LaneTag } from '@/app/server/wire/chat'
import type { ServerFrame } from '@/app/server/wire/socket'
import type { WsData } from '@/app/server/ws/socket'
import type { OperatorMessage } from '@/core/errors'
import type { EventBus } from '@/core/events'
import type { RunId, SessionId } from '@/core/ids'
import { API_CHANNEL } from '@/app/server/channel'
import { operatorText, toErrorCode } from '@/app/server/http/dispatch'
import { toCommandLaneKey } from '@/core/command-lane'
import { bindLocale, t } from '@/i18n'

/** False when the socket dropped the frame (closed, or its buffer is full): Bun answers 0 then,
 *  -1 for a frame queued behind backpressure, and the byte count otherwise. */
/** The tag a message's frames carry: its client id when it was sent with one. */
export function toLaneTag(id: string | undefined): LaneTag {
  return id === undefined ? {} : { id }
}

export function send(ws: ServerWebSocket<WsData>, frame: ServerFrame): boolean {
  return ws.send(JSON.stringify(frame)) !== 0
}

/** Stable code plus the operator's sentence, never the error's message: a socket is not a log. `id`
 *  names the lane command the error belongs to. */
export function sendRunError(ws: ServerWebSocket<WsData>, err: unknown, id?: string): void {
  const { locale } = ws.data.services

  send(ws, {
    type: 'chat',
    kind: 'error',
    code: toErrorCode(err),
    message: operatorText(locale, err) ?? t(locale, 'errors.unexpected'),
    ...(id === undefined ? {} : { id }),
  })
}

/** A run that failed on something the operator can fix (a model key not set): their sentence goes
 *  in an error frame, and the `done` that follows still closes the turn. */
export function sendOperatorFailure(
  ws: ServerWebSocket<WsData>,
  operator: OperatorMessage,
  tag: LaneTag
): void {
  const { locale } = ws.data.services

  send(ws, {
    type: 'chat',
    kind: 'error',
    code: 'unavailable',
    message: bindLocale(locale).translate(operator.key, operator.params),
    ...tag,
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

export function registerCommandRun(
  ws: ServerWebSocket<WsData>,
  sessionId: SessionId,
  controller: AbortController
): boolean {
  const registered = registerSocketRun(ws, sessionId, controller)

  if (registered) {
    ws.data.commandRuns.set(controller, undefined)
  }

  return registered
}

/** Names the lane entry a command's controller stands for, so a closing socket can drop it. */
export function trackLaneItem(
  ws: ServerWebSocket<WsData>,
  controller: AbortController,
  id: string
): void {
  ws.data.commandRuns.set(controller, id)
}

/** A closing socket takes its commands out of the line at once, freeing their slots and route
 *  registrations; a command already running is untouched here and aborted by the caller. */
export function dropWaitingCommands(ws: ServerWebSocket<WsData>): void {
  for (const [sessionId, controllers] of ws.data.activeRuns) {
    const key = toCommandLaneKey(API_CHANNEL, sessionId)

    for (const controller of controllers) {
      const id = ws.data.commandRuns.get(controller)

      if (id !== undefined) {
        ws.data.services.commandLane.drop(key, id)
      }
    }
  }
}

/** Stops the slash commands this socket runs for the session, leaving its agent turn alone. */
export function abortCommandRuns(ws: ServerWebSocket<WsData>, sessionId: SessionId): void {
  for (const controller of ws.data.activeRuns.get(sessionId) ?? []) {
    if (ws.data.commandRuns.has(controller)) {
      controller.abort()
    }
  }
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
  ws.data.commandRuns.delete(controller)

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
  ws.data.services.commandLane.cancel(toCommandLaneKey(API_CHANNEL, sessionId))
}

/** The engine run an agent turn of this session becomes, learned from the bus because the runner
 *  returns its result only. The session queue runs one turn at a time, so the first top-level run
 *  the session announces while this one is active is it. */
export function followRunId(
  bus: EventBus,
  sessionId: SessionId
): { readonly current: () => RunId | undefined; readonly stop: () => void } {
  let found: RunId | undefined
  const off = bus.on('run_started', (e) => {
    if (
      found === undefined &&
      e.channel === API_CHANNEL &&
      e.sessionId === sessionId &&
      e.parentRunId === undefined
    ) {
      found = e.runId
    }
  })

  return { current: () => found, stop: off }
}
