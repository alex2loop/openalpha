import type { LaneTag } from '@/app/server/wire/chat'
import type { FrameSink } from '@/app/server/ws/frame-sink'
import type { WsServices } from '@/app/server/ws/services'
import type { OperatorMessage } from '@/core/errors'
import type { EventBus } from '@/core/events'
import type { RunId, SessionId } from '@/core/ids'
import { API_CHANNEL } from '@/app/server/channel'
import { operatorText, toErrorCode } from '@/app/server/http/dispatch'
import { toCommandLaneKey } from '@/core/command-lane'
import { bindLocale, t } from '@/i18n'

/** What one chat client owns on the server: the services its runs use and the runs themselves.
 *  The daemon holds one per socket, the browser worker one per page. */
export interface ChatClient {
  readonly services: WsServices
  readonly activeRuns: Map<SessionId, Set<AbortController>>
  /** The slash commands among `activeRuns`, so a chat reset stops them without stopping the agent turn
   *  that shares the session's set. The value is the lane entry id of a self-contained command. */
  readonly commandRuns: Map<AbortController, string | undefined>
  /** The id of the last tagged steer each session's running turn took, so a later `steer_dropped`
   *  names it. One per session, read once, cleared when the session's last run ends. */
  readonly steerIds: Map<SessionId, string>
}

/** A client's state and the sink its frames go to, for a helper that needs both. */
export interface ChatLink {
  readonly sink: FrameSink
  readonly client: ChatClient
}

/** The tag a message's frames carry: its client id when it was sent with one. */
export function toLaneTag(id: string | undefined): LaneTag {
  return id === undefined ? {} : { id }
}

/** A tagged message's `queued` and `started` also name its session, so a client knows a new one at
 *  once; an untagged message's carry neither. */
export function toTurnTag(
  id: string | undefined,
  sessionId: SessionId
): { readonly id?: string; readonly sessionId?: string } {
  return id === undefined ? {} : { id, sessionId }
}

/** Stable code plus the operator's sentence, never the error's message: a socket is not a log. `id`
 *  names the lane command the error belongs to. */
export function sendRunError(link: ChatLink, err: unknown, id?: string): void {
  const { locale } = link.client.services

  link.sink.send({
    type: 'chat',
    kind: 'error',
    code: toErrorCode(err),
    message: operatorText(locale, err) ?? t(locale, 'errors.unexpected'),
    ...(id === undefined ? {} : { id }),
  })
}

/** A run that failed on something the operator can fix (a model key not set): their sentence goes
 *  in an error frame, and the `done` that follows still closes the turn. */
export function sendOperatorFailure(link: ChatLink, operator: OperatorMessage, tag: LaneTag): void {
  const { locale } = link.client.services

  link.sink.send({
    type: 'chat',
    kind: 'error',
    code: 'unavailable',
    message: bindLocale(locale).translate(operator.key, operator.params),
    ...tag,
  })
}

export function registerRun(
  link: ChatLink,
  sessionId: SessionId,
  controller: AbortController
): boolean {
  const { sink, client } = link

  if (sink.closed) {
    controller.abort()

    return false
  }

  const controllers = client.activeRuns.get(sessionId)

  if (controllers === undefined) {
    client.activeRuns.set(sessionId, new Set([controller]))

    return true
  }

  controllers.add(controller)

  return true
}

export function registerCommandRun(
  link: ChatLink,
  sessionId: SessionId,
  controller: AbortController
): boolean {
  const registered = registerRun(link, sessionId, controller)

  if (registered) {
    link.client.commandRuns.set(controller, undefined)
  }

  return registered
}

/** Names the lane entry a command's controller stands for, so a closing client can drop it. */
export function trackLaneItem(client: ChatClient, controller: AbortController, id: string): void {
  client.commandRuns.set(controller, id)
}

/** A closing client takes its commands out of the line at once, freeing their slots and route
 *  registrations; a command already running is untouched here and aborted by the caller. */
export function dropWaitingCommands(client: ChatClient): void {
  for (const [sessionId, controllers] of client.activeRuns) {
    const key = toCommandLaneKey(API_CHANNEL, sessionId)

    for (const controller of controllers) {
      const id = client.commandRuns.get(controller)

      if (id !== undefined) {
        client.services.commandLane.drop(key, id)
      }
    }
  }
}

/** Stops the slash commands this client runs for the session, leaving its agent turn alone. */
export function abortCommandRuns(client: ChatClient, sessionId: SessionId): void {
  for (const controller of client.activeRuns.get(sessionId) ?? []) {
    if (client.commandRuns.has(controller)) {
      controller.abort()
    }
  }
}

export function unregisterRun(
  client: ChatClient,
  sessionId: SessionId,
  controller: AbortController
): void {
  const controllers = client.activeRuns.get(sessionId)

  if (controllers === undefined) {
    return
  }

  controllers.delete(controller)
  client.commandRuns.delete(controller)

  // A steer can only be dropped by a run still under way, so its id leaves with the last one.
  if (controllers.size === 0) {
    client.activeRuns.delete(sessionId)
    client.steerIds.delete(sessionId)
  }
}

export function abortClientSession(client: ChatClient, sessionId: SessionId): void {
  for (const controller of client.activeRuns.get(sessionId) ?? []) {
    controller.abort()
  }

  // Session-scoped and chat-scoped: a cancel only reaches the runs this client's chat started.
  client.services.runControl.abortSession(sessionId, sessionId)
  client.services.commandLane.cancel(toCommandLaneKey(API_CHANNEL, sessionId))
}

/** Whether a command run was announced: a command refused at admission never is. */
export interface CommandStartWatch {
  hasStarted(): boolean
  stop(): void
}

export function watchCommandStart(bus: EventBus, runId: RunId): CommandStartWatch {
  let hasStarted = false
  const off = bus.on('command_started', (e) => {
    if (e.runId === runId) {
      hasStarted = true
    }
  })

  return { hasStarted: () => hasStarted, stop: off }
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
