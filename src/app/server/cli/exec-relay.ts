import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import type { ExecClientFrame, ExecServerFrame } from '@/app/server/wire/exec'
import type { EditorExit, Terminal } from '@/cli/api'
import { editorFromEnv } from '@/cli/api'
import { BRAND } from '@/core/brand'

const FOREIGN_EDITOR_MESSAGE = "the editor is not this terminal's VISUAL or EDITOR"

interface ExecRelayInput {
  readonly terminal: Terminal
  readonly send: (frame: ExecClientFrame) => void
  /** A second Ctrl+C before the daemon answered the first. */
  readonly onDoubleInterrupt: () => void
}

/** The terminal side of a forwarded command once the daemon accepted it. */
export interface ExecRelay {
  onServerFrame(frame: ExecServerFrame): void
  /** Idempotent: releases stdin, raw mode, resize and the signal subscriptions. */
  close(): void
}

interface RelayState {
  readonly terminal: Terminal
  /** The stream whose size the `exec` frame reported: stdout when a terminal, else stderr. */
  readonly sized: Terminal['stdout']
  readonly send: (frame: ExecClientFrame) => void
  readonly onData: (chunk: string) => void
  readonly onEnd: () => void
  readonly onResize: () => void
  readonly offSignals: (() => void)[]
  raw: boolean
  closed: boolean
  interruptPending: boolean
}

/** Relays stdin, resize and Ctrl+C to the daemon; raw mode stays off until the daemon asks. */
export function startExecRelay(input: ExecRelayInput): ExecRelay {
  const state = createState(input)
  const { stdin } = state.terminal

  state.offSignals.push(
    state.terminal.onInterrupt(() => interrupt(state, input.onDoubleInterrupt)),
    state.terminal.onTerminate(() => state.send({ type: 'signal', signal: 'terminate' }))
  )
  stdin.setEncoding('utf8')
  stdin.on('data', state.onData)
  stdin.on('end', state.onEnd)
  stdin.resume()
  state.sized.on('resize', state.onResize)

  return {
    onServerFrame: (frame) => {
      state.interruptPending = false
      receiveFrame(state, frame)
    },
    close: () => closeRelay(state),
  }
}

function createState(input: ExecRelayInput): RelayState {
  const { terminal } = input
  const sized = terminal.stdout.isTTY ? terminal.stdout : terminal.stderr
  const send = (frame: ExecClientFrame): void => {
    if (!state.closed) {
      input.send(frame)
    }
  }
  const state: RelayState = {
    terminal,
    sized,
    send,
    onData: (chunk) => send({ type: 'input', data: chunk }),
    onEnd: () => send({ type: 'input_end' }),
    onResize: () => send({ type: 'resize', columns: sized.columns, rows: sized.rows }),
    offSignals: [],
    raw: false,
    closed: false,
    interruptPending: false,
  }

  return state
}

/** The first Ctrl+C goes to the command; a second before any answer gives up on it. */
function interrupt(state: RelayState, onDoubleInterrupt: () => void): void {
  if (state.interruptPending) {
    onDoubleInterrupt()

    return
  }

  state.interruptPending = true
  state.send({ type: 'signal', signal: 'interrupt' })
}

function closeRelay(state: RelayState): void {
  if (state.closed) {
    return
  }

  const { stdin } = state.terminal

  state.closed = true

  for (const off of state.offSignals) {
    off()
  }

  stdin.off('data', state.onData)
  stdin.off('end', state.onEnd)
  state.sized.off('resize', state.onResize)

  try {
    setRaw(state, false)
  } finally {
    stdin.pause()
  }
}

function receiveFrame(state: RelayState, frame: ExecServerFrame): void {
  if (frame.type === 'raw') {
    setRaw(state, frame.on)
  } else if (frame.type === 'edit') {
    // Restoring the terminal can still throw; the daemon drops an answer it no longer waits for.
    editFile(state, frame).catch((err: unknown) => {
      state.send({ type: 'edited', kind: 'failed', message: toMessage(err) })
    })
  }
}

type EditFrame = Extract<ExecServerFrame, { readonly type: 'edit' }>

/** The editor owns the terminal while it runs: stdin is not relayed and raw mode is off. */
async function editFile(state: RelayState, frame: EditFrame): Promise<void> {
  const { stdin } = state.terminal
  const raw = state.raw
  let dir: string | undefined

  stdin.off('data', state.onData)
  stdin.pause()
  setRaw(state, false)

  try {
    dir = await mkdtemp(join(tmpdir(), `${BRAND.name}-edit-`))
    const path = join(dir, basename(frame.fileName))

    await writeFile(path, frame.text, 'utf8')
    state.send(await toEditedFrame(await openOwnEditor(state.terminal, frame.editor, path), path))
  } catch (err: unknown) {
    state.send({ type: 'edited', kind: 'failed', message: toMessage(err) })
  } finally {
    if (dir !== undefined) {
      // A temp dir left behind is not worth failing the command over.
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }

    if (!state.closed) {
      setRaw(state, raw)
      stdin.on('data', state.onData)
      stdin.resume()
    }
  }
}

/** Only the editor this terminal names runs here: the daemon never chooses a shell command for it. */
function openOwnEditor(terminal: Terminal, editor: string, path: string): Promise<EditorExit> {
  const own = editorFromEnv(terminal.env)?.trim()

  if (own !== editor) {
    return Promise.resolve({ kind: 'failed', message: FOREIGN_EDITOR_MESSAGE })
  }

  return terminal.openEditor(own, path)
}

type EditedFrame = Extract<ExecClientFrame, { readonly type: 'edited' }>

/** The text goes back only when the editor exited 0, as an editor saving in place. */
async function toEditedFrame(exit: EditorExit, path: string): Promise<EditedFrame> {
  if (exit.kind === 'failed') {
    return { type: 'edited', kind: 'failed', message: exit.message }
  }

  if (exit.code !== 0) {
    return { type: 'edited', kind: 'exited', code: exit.code }
  }

  return { type: 'edited', kind: 'exited', code: 0, text: await readFile(path, 'utf8') }
}

function setRaw(state: RelayState, on: boolean): void {
  const { stdin } = state.terminal

  if (stdin.isTTY && state.raw !== on) {
    stdin.setRawMode(on)
  }

  state.raw = on
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
