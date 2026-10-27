import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

import type { ExecClientFrame, ExecServerFrame, ExecStartFrame } from '@/app/server/wire/exec'
import type { EditorExit, Terminal, TerminalInput, TerminalOutput } from '@/cli/api'
import { EXIT_TERMINATED, pickTerminalEnv } from '@/cli/api'
import { HALT_SPEC } from '@/core/errors'

/** The longest text one `output` frame carries. */
const EXEC_OUTPUT_CHUNK_CHARS = 65_536
const HIGH_SURROGATE_FIRST = 0xd8_00
const HIGH_SURROGATE_LAST = 0xdb_ff
// What a signal nothing listens to exits with, as the process's default action would.
const SIGNAL_EXIT = { interrupt: HALT_SPEC.abort.exitCode, terminate: EXIT_TERMINATED } as const
// Never shown: a closed connection has no terminal left to print the editor's failure on.
const CLOSED_EDIT: EditedFrame = { type: 'edited', kind: 'failed', message: 'connection closed' }

type Send = (frame: ExecServerFrame) => void

type EditedFrame = Extract<ExecClientFrame, { readonly type: 'edited' }>

type ExecSignal = keyof typeof SIGNAL_EXIT

/** The terminal a forwarded command runs against: the connection, not the daemon's own process. */
export interface ExecTerminal extends Terminal {
  /** Hands one frame after `exec` to the command. */
  deliver(frame: ExecClientFrame): void
  /** Sends `exit` and closes; false when the terminal had already closed and nothing was sent. */
  exit(code: number): boolean
  /** The connection went away: idempotent, sends nothing. */
  close(): void
  /** Aborts on close, so also on an interrupt or terminate nothing in the command listens to. */
  readonly aborted: AbortSignal
}

interface ExecStreams {
  readonly stdin: ExecInput
  readonly stdout: ExecOutput
  readonly stderr: ExecOutput
}

class ExecInput extends PassThrough implements TerminalInput {
  readonly isTTY: boolean
  isRaw = false
  readonly #onRaw: (on: boolean) => void

  constructor(isTTY: boolean, onRaw: (on: boolean) => void) {
    super()
    this.isTTY = isTTY
    this.#onRaw = onRaw
  }

  setRawMode(on: boolean): this {
    if (on !== this.isRaw) {
      this.isRaw = on
      this.#onRaw(on)
    }

    return this
  }
}

interface OutputSize {
  readonly isTTY: boolean
  readonly columns: number
  readonly rows: number
}

/** Emits `'resize'` when the terminal reports a new size. */
class ExecOutput extends Writable implements TerminalOutput {
  readonly isTTY: boolean
  columns: number
  rows: number
  readonly #decoder = new StringDecoder('utf8')
  readonly #emitText: (text: string) => void

  constructor(size: OutputSize, emitText: (text: string) => void) {
    super()
    this.isTTY = size.isTTY
    this.columns = toSize(size.isTTY, size.columns)
    this.rows = toSize(size.isTTY, size.rows)
    this.#emitText = emitText
  }

  // Strings arrive as Buffers (`decodeStrings`); the decoder holds a character split across writes.
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.#emitText(this.#decoder.write(chunk))
    callback()
  }

  override _final(callback: () => void): void {
    this.#emitText(this.#decoder.end())
    callback()
  }

  resize(columns: number, rows: number): void {
    this.columns = toSize(this.isTTY, columns)
    this.rows = toSize(this.isTTY, rows)
    this.emit('resize')
  }
}

export function createExecTerminal(start: ExecStartFrame, send: Send): ExecTerminal {
  const life = createLifecycle(send, () => {
    editor.close()
    endInput(io.stdin)
  })
  const editor = createEditRelay(life.send)
  const io = createExecStreams(start, life.send)

  return {
    ...io,
    env: pickTerminalEnv(start.env),
    flags: { quiet: start.quiet, verbose: start.verbose, noColor: start.noColor },
    suspendable: false,
    aborted: life.aborted,
    onInterrupt: (fn) => subscribe(life.subscribers.interrupt, fn),
    onTerminate: (fn) => subscribe(life.subscribers.terminate, fn),
    interrupt: () => raiseSignal(life, 'interrupt'),
    openEditor: (command, path) => editor.open(command, path),
    deliver: (frame) =>
      deliverFrame(frame, { io, editor, raise: (signal) => raiseSignal(life, signal) }),
    exit: life.exit,
    close: life.close,
  }
}

interface Lifecycle {
  /** Drops every frame once the terminal closed. */
  readonly send: Send
  readonly aborted: AbortSignal
  readonly subscribers: Readonly<Record<ExecSignal, Set<() => void>>>
  exit(code: number): boolean
  close(): void
}

function createLifecycle(send: Send, onClose: () => void): Lifecycle {
  const controller = new AbortController()
  const subscribers = { interrupt: new Set<() => void>(), terminate: new Set<() => void>() }
  let closed = false

  const close = (): void => {
    if (closed) {
      return
    }

    closed = true

    try {
      onClose()
      fire(subscribers.terminate)
    } finally {
      controller.abort()
    }
  }
  const exit = (code: number): boolean => {
    if (closed) {
      return false
    }

    send({ type: 'exit', code })
    close()

    return true
  }

  return {
    send: (frame) => {
      if (!closed) {
        send(frame)
      }
    },
    aborted: controller.signal,
    subscribers,
    exit,
    close,
  }
}

// With nothing listening the command cannot stop itself, so the terminal ends it.
function raiseSignal(life: Lifecycle, signal: ExecSignal): void {
  const listening = life.subscribers[signal]

  if (listening.size === 0) {
    life.exit(SIGNAL_EXIT[signal])
  } else {
    fire(listening)
  }
}

function createExecStreams(start: ExecStartFrame, send: Send): ExecStreams {
  const { terminal } = start
  const { columns, rows } = terminal

  return {
    stdin: new ExecInput(terminal.stdinIsTTY, (on) => send({ type: 'raw', on })),
    stdout: new ExecOutput({ isTTY: terminal.stdoutIsTTY, columns, rows }, (text) =>
      sendOutput(send, 'out', text)
    ),
    stderr: new ExecOutput({ isTTY: terminal.stderrIsTTY, columns, rows }, (text) =>
      sendOutput(send, 'err', text)
    ),
  }
}

interface DeliveryTargets {
  readonly io: ExecStreams
  readonly editor: EditRelay
  readonly raise: (signal: ExecSignal) => void
}

function deliverFrame(frame: ExecClientFrame, targets: DeliveryTargets): void {
  const { io } = targets

  switch (frame.type) {
    case 'input':
      if (!io.stdin.writableEnded) {
        io.stdin.write(frame.data)
      }

      return
    case 'input_end':
      endInput(io.stdin)

      return
    case 'resize':
      io.stdout.resize(frame.columns, frame.rows)
      io.stderr.resize(frame.columns, frame.rows)

      return
    case 'signal':
      targets.raise(frame.signal)

      return
    case 'edited':
      targets.editor.settle(frame)

      return
    // One command per connection: a second `exec` starts nothing.
    case 'exec':
      return
    default:
      frame satisfies never
  }
}

interface EditRelay {
  open(editor: string, path: string): Promise<EditorExit>
  /** Answers the edit waiting on the terminal, if any. */
  settle(frame: EditedFrame): void
  /** Fails the waiting edit and every later one. */
  close(): void
}

/** One edit at a time: a second waits for the first to come back. */
function createEditRelay(send: Send): EditRelay {
  let tail: Promise<unknown> = Promise.resolve()
  let pending: ((frame: EditedFrame) => void) | undefined
  let closed = false

  const settle = (frame: EditedFrame): void => {
    const resolve = pending

    pending = undefined
    resolve?.(frame)
  }
  const ask = (edit: { readonly editor: string; readonly path: string; readonly text: string }) =>
    new Promise<EditedFrame>((resolve) => {
      if (closed) {
        resolve(CLOSED_EDIT)

        return
      }

      pending = resolve
      send({ type: 'edit', editor: edit.editor, fileName: basename(edit.path), text: edit.text })
    })
  const editOnce = async (editor: string, path: string): Promise<EditorExit> => {
    let text: string

    try {
      text = await readFile(path, 'utf8')
    } catch (err: unknown) {
      return { kind: 'failed', message: toMessage(err) }
    }

    const edited = await ask({ editor, path, text })

    return await writeBack(path, { before: text, edited })
  }

  return {
    open: (editor, path) => {
      const run = tail.then(() => editOnce(editor, path))

      // The tail only orders the edits; each failure is its own caller's.
      tail = run.catch(() => undefined)

      return run
    },
    settle,
    close: () => {
      closed = true
      settle(CLOSED_EDIT)
    },
  }
}

/** The text goes back only when the editor exited 0 and changed it, as an editor saving in place. */
async function writeBack(
  path: string,
  edit: { readonly before: string; readonly edited: EditedFrame }
): Promise<EditorExit> {
  const { before, edited } = edit

  if (edited.kind === 'failed') {
    return { kind: 'failed', message: edited.message }
  }

  if (edited.code === 0 && edited.text !== undefined && edited.text !== before) {
    try {
      await writeFile(path, edited.text, 'utf8')
    } catch (err: unknown) {
      return { kind: 'failed', message: toMessage(err) }
    }
  }

  return { kind: 'exited', code: edited.code }
}

function sendOutput(send: Send, stream: 'out' | 'err', text: string): void {
  let rest = text

  while (rest.length > 0) {
    const cut = toChunkEnd(rest)

    send({ type: 'output', stream, data: rest.slice(0, cut) })
    rest = rest.slice(cut)
  }
}

/** Never splits a surrogate pair, so each frame's text stands as UTF-8 on its own. */
function toChunkEnd(text: string): number {
  if (text.length <= EXEC_OUTPUT_CHUNK_CHARS) {
    return text.length
  }

  const last = text.charCodeAt(EXEC_OUTPUT_CHUNK_CHARS - 1)
  const isHighSurrogate = last >= HIGH_SURROGATE_FIRST && last <= HIGH_SURROGATE_LAST

  return isHighSurrogate ? EXEC_OUTPUT_CHUNK_CHARS - 1 : EXEC_OUTPUT_CHUNK_CHARS
}

// A pipe has no size: in-process its `columns` is undefined, and NaN reads the same to every width
// guard (`Number.isFinite`, `||`), so a piped command renders as it does in-process.
function toSize(isTTY: boolean, size: number): number {
  return isTTY && size > 0 ? size : Number.NaN
}

function endInput(stdin: ExecInput): void {
  if (!stdin.writableEnded) {
    stdin.end()
  }
}

function subscribe(subscribers: Set<() => void>, fn: () => void): () => void {
  subscribers.add(fn)

  return () => {
    subscribers.delete(fn)
  }
}

function fire(subscribers: Set<() => void>): void {
  for (const fn of [...subscribers]) {
    fn()
  }
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
