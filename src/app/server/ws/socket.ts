import type { ServerWebSocket, WebSocketHandler } from 'bun'

import { z } from 'zod'

import type { ChatBody } from '@/app/server/wire/chat'
import type { WireEvent } from '@/app/server/wire/events'
import type { ClientFrame } from '@/app/server/wire/socket'
import type { SlashDispatcher } from '@/commands/api'
import type { EventBus } from '@/core/events'
import type { SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type {
  ChatBindingStore,
  CommandLane,
  SessionOpener,
  SessionQueue,
} from '@/core/types/session'
import type { AgentProfile, Runner } from '@/engine/api'
import type { BrowserSessionStore } from '@/persistence/api'
import { API_CHANNEL } from '@/app/server/channel'
import { CHAT_CLIENT_ID_MAX } from '@/app/server/wire/chat'
import {
  CONTRACT_REFUSED_CLOSE_CODE,
  CONTRACT_REFUSED_REASON_PREFIX,
  CONTRACT_VERSION,
} from '@/app/server/wire/socket'
import { resolveSessionId, runChat } from '@/app/server/ws/chat'
import {
  abortCommandRuns,
  abortSocketSession,
  dropWaitingCommands,
  send,
  sendRunError,
  toLaneTag,
} from '@/app/server/ws/runs'
import { runSlash } from '@/app/server/ws/slash'
import { toApprovalWire, WIRE_NORMALIZERS } from '@/app/server/ws/wire-events'
import { toCommandLaneKey } from '@/core/command-lane'
import { sessionId as brandSessionId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale } from '@/i18n'

const MAX_SOCKETS = 8
// The server's maxPayloadLength, and a second check before JSON.parse.
export const MAX_WS_FRAME_BYTES = 1_048_576
const SIGNED_OUT_CLOSE_CODE = 4401
const SIGNED_OUT_REASON = 'signed_out'

const CHAT_CLIENT_ID_RE = /^[A-Za-z0-9_-]+$/
const CHAT_FIELDS = {
  message: z.string(),
  sessionId: z.string().exactOptional(),
  id: z.string().max(CHAT_CLIENT_ID_MAX).regex(CHAT_CLIENT_ID_RE).exactOptional(),
}

const WS_FRAME: z.ZodType<ClientFrame> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat'), ...CHAT_FIELDS }),
  z.object({ type: z.literal('steer'), ...CHAT_FIELDS }),
  z.object({ type: z.literal('cancel'), sessionId: z.string() }),
  z.object({ type: z.literal('drop'), sessionId: z.string(), id: z.string() }),
  z.object({ type: z.literal('hello'), contractVersion: z.number() }),
])

/** Server-owned interface: a socket aborts the runs it owns and steers the one running. */
interface WsRunControl {
  abortSession(sessionId: SessionId, chatId: string): boolean
  steer(sessionId: SessionId, chatId: string, text: string): boolean
}

export interface WsServices {
  readonly agents: ReadonlyMap<string, AgentProfile>
  /** `[api] orders`: whether `/trade` may run from the app. */
  readonly apiOrders: boolean
  readonly bindings: ChatBindingStore
  readonly browserSessions: Pick<BrowserSessionStore, 'has'>
  readonly bus: EventBus
  readonly commandLane: CommandLane
  readonly locale: Locale
  readonly logger: Logger
  readonly runControl: WsRunControl
  readonly runner: Runner
  readonly sessionQueue: SessionQueue
  readonly sessions: SessionOpener
  readonly slashDispatcher: SlashDispatcher
}

export interface WsData {
  readonly services: WsServices
  /** The browser session that opened the socket; absent for a bearer-token client. */
  readonly browserSessionId?: string
  readonly activeRuns: Map<SessionId, Set<AbortController>>
  /** The slash commands among `activeRuns`, so a chat reset stops them without stopping the agent turn
   *  that shares the session's set. The value is the lane entry id of a self-contained command. */
  readonly commandRuns: Map<AbortController, string | undefined>
  /** The id of the last tagged steer each session's running turn took, so a later `steer_dropped`
   *  names it. One per session, read once, cleared when the session's last run ends. */
  readonly steerIds: Map<SessionId, string>
  closed: boolean
  off?: () => void
}

// Process-local: these are this process's live sockets, capped at MAX_SOCKETS.
const sockets = new Set<ServerWebSocket<WsData>>()

// Set once the daemon starts down: the listener is closed, but an open socket still reaches the
// dispatcher, so the frames that start work are refused here.
let admissionClosed = false

export function closeSocketAdmission(): void {
  admissionClosed = true
}

/** The handshake asks before upgrading; `open` asks again for the upgrades that race to the last
 *  seat. Both answer the same question. */
export function hasSocketRoom(): boolean {
  return sockets.size < MAX_SOCKETS
}

export const wsHandlers: WebSocketHandler<WsData> = {
  open(ws): void {
    if (!hasSocketRoom()) {
      ws.close(1013, 'too_many_streams')

      return
    }

    sockets.add(ws)

    if (ws.data.browserSessionId !== undefined) {
      closeIfSignedOut(ws, ws.data.browserSessionId)
    }

    const { bus } = ws.data.services
    // Subscribed one topic at a time on purpose: iterating the union would collapse the
    // payload types into their intersection, which no event satisfies.
    const offs = [
      // Every channel's approval is shown; only an API one is `answerable`, since a channel run's
      // approval resolves on its own channel.
      bus.on('approval_requested', (e) => {
        relay(ws, toApprovalWire(e, ws.data.services.locale))
      }),
      bus.on('approval_resolved', (e) => {
        relay(ws, WIRE_NORMALIZERS.approval_resolved(e))
      }),
      bus.on('clarification_requested', (e) => {
        relay(ws, WIRE_NORMALIZERS.clarification_requested(e))
      }),
      bus.on('budget_warning', (e) => {
        relay(ws, WIRE_NORMALIZERS.budget_warning(e))
      }),
      bus.on('pairing_requested', (e) => {
        relay(ws, WIRE_NORMALIZERS.pairing_requested(e))
      }),
      // A steer the run accepted but ended before reading: the operator has to send it again.
      bus.on('steering_dropped', (e) => {
        if (e.channel === API_CHANNEL && ws.data.activeRuns.has(e.sessionId)) {
          const id = ws.data.steerIds.get(e.sessionId)

          ws.data.steerIds.delete(e.sessionId)
          send(ws, {
            type: 'chat',
            kind: 'steer_dropped',
            text: steerDroppedText(ws, e.count),
            ...toLaneTag(id),
          })
        }
      }),
      // `/new` moves the chat to a session of its own: the commands still running for the old one
      // stop, and the ones waiting were already dropped by the lane.
      bus.on('chat_session_reset', (e) => {
        if (e.channel === API_CHANNEL) {
          abortCommandRuns(ws, brandSessionId(e.chatId))
        }
      }),
      bus.on('provider_fallback', (e) => {
        const ownsRun =
          ws.data.activeRuns.has(e.sessionId) ||
          (e.chatId !== undefined && ws.data.activeRuns.has(brandSessionId(e.chatId)))

        if (e.channel === API_CHANNEL && ownsRun) {
          relay(ws, WIRE_NORMALIZERS.provider_fallback(e))
        }
      }),
    ]

    ws.data.off = (): void => {
      for (const off of offs) {
        off()
      }
    }
  },

  // Bun does not catch a rejected async handler and the daemon exits on an unhandled rejection,
  // so a failed frame is answered on the socket and never rethrown.
  async message(ws, raw): Promise<void> {
    try {
      await handleMessage(ws, raw)
    } catch (err: unknown) {
      ws.data.services.logger.warn('api.ws_message_failed', { err: formatErrForLog(err) })
      sendRunError(ws, err)
    }
  },

  close(ws): void {
    closeSocket(ws)
  },
}

async function handleMessage(ws: ServerWebSocket<WsData>, raw: string | Buffer): Promise<void> {
  // Binary frames carry nothing: dictation is transcribed on the device and sent as text.
  if (typeof raw !== 'string') {
    return
  }

  const frame = parseFrame(raw)

  if (frame === null) {
    ws.close(1002, 'invalid_frame')

    return
  }

  if (frame.type === 'hello' || frame.type === 'cancel' || frame.type === 'drop') {
    handleControl(ws, frame)

    return
  }

  if (admissionClosed) {
    send(ws, {
      type: 'chat',
      kind: 'error',
      code: 'unavailable',
      message: bindLocale(ws.data.services.locale).translate('halt.shutdown'),
      ...toLaneTag(frame.id),
    })

    return
  }

  const session = resolveSessionId(frame.sessionId)

  if (frame.type === 'steer' && steer(ws, session, frame)) {
    return
  }

  const line = frame.message.trim()
  const request = line.startsWith('/')
    ? await runSlash(ws, session, { line, ...toLaneTag(frame.id) })
    : { message: frame.message, ...toLaneTag(frame.id) }

  if (request !== null) {
    await runChat(ws, session, request)
  }
}

/** A steer joins the turn already running, at its next turn boundary. A turn that already ended
 *  cannot take it, and it is not run on its own: the client stopped reading that reply, so it is
 *  sent back as dropped. A slash command is never steered; it runs as an ordinary message. */
function steer(ws: ServerWebSocket<WsData>, session: SessionId, frame: ChatBody): boolean {
  const { message, id } = frame

  if (message.trim().startsWith('/')) {
    return false
  }

  if (ws.data.services.runControl.steer(session, session, message)) {
    if (id !== undefined) {
      ws.data.steerIds.set(session, id)
    }

    send(ws, { type: 'chat', kind: 'steered', ...toLaneTag(id) })
  } else {
    send(ws, {
      type: 'chat',
      kind: 'steer_dropped',
      text: steerDroppedText(ws, 1),
      ...toLaneTag(id),
    })
  }

  return true
}

function steerDroppedText(ws: ServerWebSocket<WsData>, count: number): string {
  const key = count === 1 ? 'channel.steeringDroppedOne' : 'channel.steeringDropped'

  return bindLocale(ws.data.services.locale).translate(key, { count })
}

/** Sends one event to every open socket and says how many took it; a dropped frame is not one. */
export function broadcast(event: WireEvent): number {
  let delivered = 0

  for (const ws of sockets) {
    if (relay(ws, event)) {
      delivered += 1
    }
  }

  return delivered
}

/** Force-close every live socket. Registered as a disposer next to the api's stop(). */
export function closeAllSockets(): void {
  for (const ws of [...sockets]) {
    closeSocket(ws)
    ws.close(1001, 'shutdown')
  }
}

/** Closes the sockets a browser session opened, once it has ended. */
export function closeSocketsOf(browserSessionId: string): void {
  for (const ws of [...sockets]) {
    if (ws.data.browserSessionId === browserSessionId) {
      closeSignedOut(ws)
    }
  }
}

/** A sign-out that ran while this socket's handshake was being judged found no socket to close, so
 *  an opened socket asks once more. A failed read closes it too: fail closed. */
function closeIfSignedOut(ws: ServerWebSocket<WsData>, browserSessionId: string): void {
  const { browserSessions, logger } = ws.data.services

  browserSessions
    .has(browserSessionId)
    .then((live) => {
      if (!live) {
        closeSignedOut(ws)
      }
    })
    .catch((err: unknown) => {
      logger.warn('api.ws_session_check_failed', { err: formatErrForLog(err) })
      closeSignedOut(ws)
    })
}

function closeSignedOut(ws: ServerWebSocket<WsData>): void {
  if (ws.data.closed) {
    return
  }

  closeSocket(ws)
  ws.close(SIGNED_OUT_CLOSE_CODE, SIGNED_OUT_REASON)
}

function closeSocket(ws: ServerWebSocket<WsData>): void {
  if (ws.data.closed) {
    return
  }

  sockets.delete(ws)
  ws.data.closed = true

  const off = ws.data.off
  delete ws.data.off

  try {
    off?.()
  } catch {
    // Listener cleanup must not prevent the socket's owned runs from being cancelled.
  }

  dropWaitingCommands(ws)
  ws.data.steerIds.clear()

  for (const [sessionId, controllers] of ws.data.activeRuns) {
    for (const controller of controllers) {
      controller.abort()
    }

    ws.data.services.runControl.abortSession(sessionId, sessionId)
  }
}

function relay(ws: ServerWebSocket<WsData>, event: WireEvent): boolean {
  return send(ws, { type: 'wire_event', ...event })
}

function parseFrame(raw: string): ClientFrame | null {
  if (raw.length > MAX_WS_FRAME_BYTES) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = WS_FRAME.safeParse(parsed)

  return result.success ? result.data : null
}

/** The frames that carry no message: the handshake, an interrupt and a command pulled from the
 *  line. The lane rejects the dropped command, and the socket that ran it answers `dropped`. */
function handleControl(
  ws: ServerWebSocket<WsData>,
  frame: Extract<ClientFrame, { readonly type: 'hello' | 'cancel' | 'drop' }>
): void {
  if (frame.type === 'cancel') {
    abortSocketSession(ws, resolveSessionId(frame.sessionId))

    return
  }

  if (frame.type === 'drop') {
    const key = toCommandLaneKey(API_CHANNEL, resolveSessionId(frame.sessionId))

    ws.data.services.commandLane.drop(key, frame.id)

    return
  }

  if (frame.contractVersion === CONTRACT_VERSION) {
    send(ws, { type: 'welcome', contractVersion: CONTRACT_VERSION })
  } else {
    ws.close(
      CONTRACT_REFUSED_CLOSE_CODE,
      `${CONTRACT_REFUSED_REASON_PREFIX}${CONTRACT_VERSION} required`
    )
  }
}
