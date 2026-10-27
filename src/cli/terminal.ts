import type { Readable, Writable } from 'node:stream'
import { AsyncLocalStorage } from 'node:async_hooks'
import { spawn } from 'node:child_process'

import { BRAND } from '@/core/brand'

export const TERMINAL_ENV_NAMES = [
  'NO_COLOR',
  'FORCE_COLOR',
  'TERM',
  'CI',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'VISUAL',
  'EDITOR',
] as const
// PowerShell cannot take the file as a positional argument, so it reads it from the environment.
const FILE_ENV = BRAND.controlEnv.editorFile
const NO_FLAGS = { quiet: false, verbose: false, noColor: false }

// Process-wide, one per process: the terminal the entry installed. A forwarded command runs inside
// `withTerminal`, so the store scopes its terminal to that command's async context.
const scopedTerminal = new AsyncLocalStorage<Terminal>()
let processTerminal: Terminal | undefined

type TerminalEnvName = (typeof TERMINAL_ENV_NAMES)[number]

export type TerminalEnv = Readonly<Partial<Record<TerminalEnvName, string>>>

export interface TerminalInput extends Readable {
  readonly isTTY: boolean
  readonly isRaw: boolean
  setRawMode(on: boolean): unknown
}

/** Emits `'resize'` when the window changes size. */
export interface TerminalOutput extends Writable {
  readonly isTTY: boolean
  readonly columns: number
  readonly rows: number
}

interface TerminalFlags {
  readonly quiet: boolean
  readonly verbose: boolean
  readonly noColor: boolean
}

export type EditorExit =
  | { readonly kind: 'exited'; readonly code: number }
  | { readonly kind: 'failed'; readonly message: string }

export interface Terminal {
  readonly stdin: TerminalInput
  readonly stdout: TerminalOutput
  readonly stderr: TerminalOutput
  readonly env: TerminalEnv
  readonly flags: TerminalFlags
  readonly suspendable: boolean
  onInterrupt(fn: () => void): () => void
  onTerminate(fn: () => void): () => void
  interrupt(): void
  openEditor(editor: string, path: string): Promise<EditorExit>
}

interface TerminalWriters {
  readonly out: (line: string) => void
  readonly err: (line: string) => void
  readonly write: (chunk: string) => void
}

export function installProcessTerminal(flags: TerminalFlags): Terminal {
  processTerminal = createProcessTerminal(flags)

  return processTerminal
}

export function currentTerminal(): Terminal {
  const scoped = scopedTerminal.getStore()

  if (scoped !== undefined) {
    return scoped
  }

  processTerminal ??= createProcessTerminal(NO_FLAGS)

  return processTerminal
}

export function withTerminal<T>(terminal: Terminal, fn: () => T): T {
  return scopedTerminal.run(terminal, fn)
}

export function toTerminalWriters(terminal: Terminal): TerminalWriters {
  return {
    out: (line) => {
      terminal.stdout.write(`${line}\n`)
    },
    err: (line) => {
      terminal.stderr.write(`${line}\n`)
    },
    write: (chunk) => {
      terminal.stdout.write(chunk)
    },
  }
}

function createProcessTerminal(flags: TerminalFlags): Terminal {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: toProcessTerminalEnv(),
    flags,
    suspendable: true,
    onInterrupt: (fn) => onProcessSignal('SIGINT', fn),
    onTerminate: (fn) => onProcessSignal('SIGTERM', fn),
    interrupt: () => {
      process.emit('SIGINT')
    },
    openEditor: openProcessEditor,
  }
}

// Live reads, not a snapshot: the key file loads into `process.env` after the entry installs the
// terminal, and a value it sets (an `EDITOR`, a `NO_COLOR`) must still count.
function toProcessTerminalEnv(): TerminalEnv {
  const env: Partial<Record<TerminalEnvName, string>> = {}

  for (const name of TERMINAL_ENV_NAMES) {
    Object.defineProperty(env, name, { enumerable: true, get: () => process.env[name] })
  }

  return env
}

function onProcessSignal(signal: 'SIGINT' | 'SIGTERM', fn: () => void): () => void {
  process.on(signal, fn)

  return () => {
    process.off(signal, fn)
  }
}

function openProcessEditor(editor: string, path: string): Promise<EditorExit> {
  return new Promise((resolve) => {
    const { file, args } = editorInvocation(editor, path)
    const env = { ...process.env, [FILE_ENV]: path }
    const child = spawn(file, args, { stdio: 'inherit', env, windowsHide: true })

    child.on('error', (err: Error) => resolve({ kind: 'failed', message: err.message }))
    // Every path settles: 'close' fires even when the editor was killed by a signal.
    child.on('close', (code) => resolve({ kind: 'exited', code: code ?? 1 }))
  })
}

// The editor value is shell text (it may quote a path or carry flags), as in git; the file is
// never part of that text, only a positional argument or an environment value.
function editorInvocation(
  command: string,
  path: string
): { readonly file: string; readonly args: string[] } {
  if (process.platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-Command', `& ${command} $env:${FILE_ENV}`],
    }
  }

  return { file: 'sh', args: ['-c', `${command} "$@"`, 'editor', path] }
}
