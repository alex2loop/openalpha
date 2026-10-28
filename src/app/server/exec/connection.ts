import type { ServerWebSocket } from 'bun'

import { z } from 'zod'

import type { ExecClientFrame, ExecServerFrame } from '@/app/server/wire/exec'
import type { ExecSocketData } from '@/app/server/ws/socket'
import {
  isExecAdmissionOpen,
  releaseExecSeat,
  seatedExecs,
  takeExecSeat,
} from '@/app/server/exec/admission'
import { runExec } from '@/app/server/exec/run'
import { createExecTerminal } from '@/app/server/exec/terminal'
import { EXEC_REFUSED_CLOSE_CODE } from '@/app/server/wire/exec'
import { CONTRACT_REFUSED_REASON_PREFIX, CONTRACT_VERSION } from '@/app/server/wire/socket'
import { MAX_WS_FRAME_BYTES } from '@/app/server/ws/socket'
import { withTerminal } from '@/cli/api'
import { formatErrForLog } from '@/core/security/credentials'

/** How long an admitted socket may wait before its `exec` frame. */
const EXEC_FIRST_FRAME_TIMEOUT_MS = 10_000
const NORMAL_CLOSE_CODE = 1000
const SHUTDOWN_CLOSE_CODE = 1001
const SHUTDOWN_REASON = 'shutdown'
// The command failed outside anything it could report itself (its commands did not resolve).
const INTERNAL_CLOSE_CODE = 1011
const INTERNAL_REASON = 'internal'
const REFUSED_FULL = 'too_many_streams'
const REFUSED_UNAVAILABLE = 'unavailable'
const REFUSED_INVALID = 'invalid_frame'
// TIOCGWINSZ reports each dimension in 16 bits; a larger one is no terminal.
const MAX_TERMINAL_CELLS = 65_535

const SIZE = z.number().int().nonnegative().max(MAX_TERMINAL_CELLS)

const EXEC_FRAME: z.ZodType<ExecClientFrame> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('exec'),
    argv: z.array(z.string()),
    terminal: z.object({
      stdinIsTTY: z.boolean(),
      stdoutIsTTY: z.boolean(),
      stderrIsTTY: z.boolean(),
      columns: SIZE,
      rows: SIZE,
    }),
    env: z.record(z.string(), z.string()),
    quiet: z.boolean(),
    verbose: z.boolean(),
    noColor: z.boolean(),
    contractVersion: z.number(),
  }),
  z.object({ type: z.literal('input'), data: z.string() }),
  z.object({ type: z.literal('input_end') }),
  z.object({ type: z.literal('resize'), columns: SIZE, rows: SIZE }),
  z.object({ type: z.literal('signal'), signal: z.enum(['interrupt', 'terminate']) }),
  z.discriminatedUnion('kind', [
    z.object({
      type: z.literal('edited'),
      kind: z.literal('exited'),
      code: z.number().int(),
      text: z.string().exactOptional(),
    }),
    z.object({ type: z.literal('edited'), kind: z.literal('failed'), message: z.string() }),
  ]),
])

// Bun does not catch a throwing handler and the daemon exits on an unhandled error, so no handler
// here throws: a failure is logged and the socket closed.
export const execHandlers = {
  open(ws: ServerWebSocket<ExecSocketData>): void {
    if (!takeExecSeat(ws)) {
      refuse(ws, REFUSED_FULL)

      return
    }

    ws.data.firstFrameTimer = setTimeout(
      () => refuse(ws, REFUSED_INVALID),
      EXEC_FIRST_FRAME_TIMEOUT_MS
    )
  },

  message(ws: ServerWebSocket<ExecSocketData>, raw: string | Buffer): void {
    try {
      handleMessage(ws, raw)
    } catch (err: unknown) {
      ws.data.app.resolve('logger').warn('api.exec_message_failed', { err: formatErrForLog(err) })
      closeWith(ws, INTERNAL_CLOSE_CODE, INTERNAL_REASON)
    }
  },

  close(ws: ServerWebSocket<ExecSocketData>): void {
    closeExec(ws)
  },
}

/** Daemon shutdown: every forwarded command is aborted and its terminal told so with 1001. */
export function closeAllExecs(): void {
  for (const ws of seatedExecs()) {
    closeWith(ws, SHUTDOWN_CLOSE_CODE, SHUTDOWN_REASON)
  }
}

function handleMessage(ws: ServerWebSocket<ExecSocketData>, raw: string | Buffer): void {
  const { data } = ws

  if (data.closed) {
    return
  }

  const { terminal } = data

  if (terminal === undefined) {
    startExec(ws, raw)

    return
  }

  const frame = parseFrame(raw)

  if (frame === null) {
    logFrameFailure(ws)

    return
  }

  // Every callback the frame reaches (keypress, resize, an edit's answer, a signal) runs as part of
  // the command, so it must read the command's terminal, never the daemon's own process.
  withTerminal(terminal, () => terminal.deliver(frame))
}

/** The first frame decides: a valid `exec` on this contract starts the command, anything else is
 *  refused before anything ran, so the terminal may run it itself. */
function startExec(ws: ServerWebSocket<ExecSocketData>, raw: string | Buffer): void {
  clearFirstFrameTimer(ws)

  const frame = parseFrame(raw)

  if (frame?.type !== 'exec') {
    refuse(ws, REFUSED_INVALID)

    return
  }

  if (frame.contractVersion !== CONTRACT_VERSION) {
    refuse(ws, `${CONTRACT_REFUSED_REASON_PREFIX}${CONTRACT_VERSION} required`)

    return
  }

  if (!isExecAdmissionOpen()) {
    refuse(ws, REFUSED_UNAVAILABLE)

    return
  }

  const terminal = createExecTerminal(frame, (out) => sendFrame(ws, out))
  const { app } = ws.data

  ws.data.terminal = terminal
  sendFrame(ws, { type: 'accepted' })

  if (ws.data.closed) {
    return
  }

  runExec(app, terminal, frame.argv).catch((err: unknown) => {
    app.resolve('logger').error('api.exec_failed', { err: formatErrForLog(err) })
    closeWith(ws, INTERNAL_CLOSE_CODE, INTERNAL_REASON)
  })
}

/** `exit` is the last frame: the socket closes normally right after it. A dropped send means the
 *  peer is gone, which ends the command as a close would. */
function sendFrame(ws: ServerWebSocket<ExecSocketData>, frame: ExecServerFrame): void {
  if (ws.data.closed) {
    return
  }

  if (ws.send(JSON.stringify(frame)) === 0) {
    closeExec(ws)

    return
  }

  if (frame.type === 'exit') {
    closeWith(ws, NORMAL_CLOSE_CODE)
  }
}

function refuse(ws: ServerWebSocket<ExecSocketData>, reason: string): void {
  closeWith(ws, EXEC_REFUSED_CLOSE_CODE, reason)
}

function closeWith(ws: ServerWebSocket<ExecSocketData>, code: number, reason?: string): void {
  if (ws.data.closed) {
    return
  }

  closeExec(ws)
  ws.close(code, reason)
}

/** Idempotent: the close handler, a refusal, `exit` and shutdown all end here. */
function closeExec(ws: ServerWebSocket<ExecSocketData>): void {
  const { data } = ws

  if (data.closed) {
    return
  }

  data.closed = true
  clearFirstFrameTimer(ws)
  releaseExecSeat(ws)

  const { terminal } = data

  if (terminal === undefined) {
    return
  }

  // Closing fires the command's terminate subscribers and aborts it, inside its own terminal. A
  // subscriber that throws must not stop the socket from closing.
  try {
    withTerminal(terminal, () => terminal.close())
  } catch (err: unknown) {
    data.app.resolve('logger').warn('api.exec_close_failed', { err: formatErrForLog(err) })
  }
}

function clearFirstFrameTimer(ws: ServerWebSocket<ExecSocketData>): void {
  clearTimeout(ws.data.firstFrameTimer)
  delete ws.data.firstFrameTimer
}

function parseFrame(raw: string | Buffer): ExecClientFrame | null {
  if (typeof raw !== 'string' || raw.length > MAX_WS_FRAME_BYTES) {
    return null
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = EXEC_FRAME.safeParse(parsed)

  return result.success ? result.data : null
}

/** Logged once per connection: a client sending bad frames would otherwise fill the log. */
function logFrameFailure(ws: ServerWebSocket<ExecSocketData>): void {
  if (ws.data.frameFailureLogged) {
    return
  }

  ws.data.frameFailureLogged = true
  ws.data.app.resolve('logger').warn('api.exec_frame_failed', {})
}
