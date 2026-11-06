import type { ServerWebSocket, WebSocketHandler } from 'bun'

import { z } from 'zod'

import type { ExecTerminal } from '@/app/server/exec/terminal'
import type { WireEvent } from '@/app/server/wire/events'
import type { ClientFrame, ServerFrame } from '@/app/server/wire/socket'
import type { FrameSink } from '@/app/server/ws/frame-sink'
import type { ChatClient } from '@/app/server/ws/runs'
import type { App } from '@/core/container'
import { CHAT_CLIENT_ID_MAX } from '@/app/server/wire/chat'
import {
  CONTRACT_REFUSED_CLOSE_CODE,
  CONTRACT_REFUSED_REASON_PREFIX,
  CONTRACT_VERSION,
} from '@/app/server/wire/socket'
import { closeChatClient, followChatBus } from '@/app/server/ws/chat-client'
import { handleChatFrame } from '@/app/server/ws/frames'
import { sendRunError, toLaneTag } from '@/app/server/ws/runs'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale } from '@/i18n'

const MAX_SOCKETS = 8
// The server's maxPayloadLength, and a second check before JSON.parse.
export const MAX_WS_FRAME_BYTES = 1_048_576
const SIGNED_OUT_CLOSE_CODE = 4401
const SIGNED_OUT_REASON = 'signed_out'

const CHAT_CLIENT_ID_RE = /^[A-Za-z0-9_-]+$/
// Blank text would start a billed turn with nothing to answer, so it is a malformed frame.
const NON_BLANK_RE = /\S/
const CHAT_FIELDS = {
  message: z.string().regex(NON_BLANK_RE),
  sessionId: z.string().exactOptional(),
  id: z.string().max(CHAT_CLIENT_ID_MAX).regex(CHAT_CLIENT_ID_RE).exactOptional(),
}

const WS_FRAME: z.ZodType<ClientFrame> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat'), ...CHAT_FIELDS, quiet: z.literal(true).exactOptional() }),
  z.object({ type: z.literal('steer'), ...CHAT_FIELDS }),
  z.object({ type: z.literal('cancel'), sessionId: z.string() }),
  z.object({ type: z.literal('drop'), sessionId: z.string(), id: z.string() }),
  z.object({ type: z.literal('hello'), contractVersion: z.number() }),
])

export interface WsData extends ChatClient {
  readonly kind: 'feed'
  /** The browser session that opened the socket; absent for a bearer-token client. */
  readonly browserSessionId?: string
  closed: boolean
  off?: () => void
}

/** A `/v1/exec` socket: one CLI command the daemon runs for a terminal. */
export interface ExecSocketData {
  readonly kind: 'exec'
  readonly app: App
  /** Armed at open, cleared by the first frame or the close, so a peer that never sends `exec`
   *  cannot hold a seat. */
  firstFrameTimer?: ReturnType<typeof setTimeout>
  /** Present once `exec` was accepted. */
  terminal?: ExecTerminal
  /** Only the first unreadable frame after `accepted` is logged. */
  frameFailureLogged: boolean
  closed: boolean
}

export type SocketData = WsData | ExecSocketData

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

export const wsHandlers = {
  open(ws): void {
    if (!hasSocketRoom()) {
      ws.close(1013, 'too_many_streams')

      return
    }

    sockets.add(ws)

    if (ws.data.browserSessionId !== undefined) {
      closeIfSignedOut(ws, ws.data.browserSessionId)
    }

    ws.data.off = followChatBus({ sink: toSocketSink(ws), client: ws.data })
  },

  // Bun does not catch a rejected async handler and the daemon exits on an unhandled rejection,
  // so a failed frame is answered on the socket and never rethrown.
  async message(ws, raw): Promise<void> {
    try {
      await handleMessage(ws, raw)
    } catch (err: unknown) {
      ws.data.services.logger.warn('api.ws_message_failed', { err: formatErrForLog(err) })
      sendRunError({ sink: toSocketSink(ws), client: ws.data }, err)
    }
  },

  close(ws): void {
    closeSocket(ws)
  },
} satisfies WebSocketHandler<WsData>

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

  if (frame.type === 'hello') {
    answerHello(ws, frame.contractVersion)

    return
  }

  const sink = toSocketSink(ws)

  if (admissionClosed && (frame.type === 'chat' || frame.type === 'steer')) {
    sink.send({
      type: 'chat',
      kind: 'error',
      code: 'unavailable',
      message: bindLocale(ws.data.services.locale).translate('halt.shutdown'),
      ...toLaneTag(frame.id),
    })

    return
  }

  await handleChatFrame(frame, sink, ws.data)
}

/** The socket as the runners see it: frames out, and whether the client is gone. */
function toSocketSink(ws: ServerWebSocket<WsData>): FrameSink {
  return {
    send: (frame): void => {
      sendFrame(ws, frame)
    },
    get closed(): boolean {
      return ws.data.closed
    },
  }
}

/** False when the socket dropped the frame (closed, or its buffer is full): Bun answers 0 then,
 *  -1 for a frame queued behind backpressure, and the byte count otherwise. */
function sendFrame(ws: ServerWebSocket<WsData>, frame: ServerFrame): boolean {
  return ws.send(JSON.stringify(frame)) !== 0
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

  closeChatClient(ws.data)
}

function relay(ws: ServerWebSocket<WsData>, event: WireEvent): boolean {
  return sendFrame(ws, { type: 'wire_event', ...event })
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

/** The handshake: a client built for another contract is refused with a close the client reads. */
function answerHello(ws: ServerWebSocket<WsData>, contractVersion: number): void {
  if (contractVersion === CONTRACT_VERSION) {
    sendFrame(ws, { type: 'welcome', contractVersion: CONTRACT_VERSION })
  } else {
    ws.close(
      CONTRACT_REFUSED_CLOSE_CODE,
      `${CONTRACT_REFUSED_REASON_PREFIX}${CONTRACT_VERSION} required`
    )
  }
}
