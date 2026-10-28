import type { TerminalEnv } from '@/cli/terminal'
import { currentTerminal } from '@/cli/terminal'

const UTF8_RE = /utf-?8/i
const TERMINAL_WIDTH_FALLBACK = 80
const MIN_TERMINAL_WIDTH = 20
// VISUAL names the full-screen editor and wins over EDITOR, the line editor, by convention.
const EDITOR_ENV_NAMES = ['VISUAL', 'EDITOR'] as const

interface TerminalPolicy {
  readonly color: boolean
  readonly animate: boolean
  readonly prompt: boolean
  readonly hyperlinks: boolean
}

interface TerminalStreams {
  readonly input: { readonly isTTY?: boolean }
  readonly output: { readonly isTTY?: boolean }
}

export function getEnv(): Record<string, string | undefined> {
  return process.env
}

export function editorFromEnv(env: TerminalEnv = currentTerminal().env): string | undefined {
  for (const name of EDITOR_ENV_NAMES) {
    const value = env[name]

    if (value !== undefined && value.trim() !== '') {
      return value
    }
  }

  return undefined
}

export function isNoColor(): boolean {
  const terminal = currentTerminal()

  if (terminal.flags.noColor) {
    return true
  }

  if (terminal.env.NO_COLOR !== undefined) {
    return true
  }

  if (isForceColor(terminal.env)) {
    return false
  }

  return !terminal.stdout.isTTY
}

function isForceColor(env: TerminalEnv): boolean {
  const forced = env.FORCE_COLOR

  return forced !== undefined && forced !== '0'
}

export function isInteractiveStdin(): boolean {
  return currentTerminal().stdin.isTTY === true
}

export function isInteractiveStdout(): boolean {
  const { stdout, env } = currentTerminal()

  if (stdout.isTTY !== true) {
    return false
  }

  // Captured streams flatten cursor redraws into one line per frame — no transient animation there.
  return env.TERM !== 'dumb' && env.CI === undefined && env.NO_COLOR === undefined
}

export function isInteractiveStderr(): boolean {
  const { stderr, env } = currentTerminal()

  return stderr.isTTY === true && env.CI === undefined
}

export function isUnicode(): boolean {
  const { env } = currentTerminal()
  const locale = env.LC_ALL ?? env.LC_CTYPE ?? env.LANG ?? ''

  return UTF8_RE.test(locale)
}

export function terminalWidth(): number {
  const columns = currentTerminal().stdout.columns

  if (columns === undefined || !Number.isFinite(columns)) {
    return TERMINAL_WIDTH_FALLBACK
  }

  return Math.max(MIN_TERMINAL_WIDTH, columns)
}

export function isQuiet(): boolean {
  return currentTerminal().flags.quiet
}

export function isVerbose(): boolean {
  return currentTerminal().flags.verbose
}

// Per-stream policy: NO_COLOR always disables color; FORCE_COLOR may enable color only (never
// animation, prompting, paging, or hyperlinks). Stdin controls prompting; the target output stream
// controls animation and hyperlinks. Resolving each stream independently lets one process write a
// colored, link-decorated TTY report while paging through a pipe-friendly fallback.
export function resolveTerminalPolicy(streams: TerminalStreams): TerminalPolicy {
  const { flags, env } = currentTerminal()
  const outputIsTty = streams.output.isTTY === true
  const inputIsTty = streams.input.isTTY === true
  const colorDisabled = flags.noColor || env.NO_COLOR !== undefined

  return {
    color: !colorDisabled && (isForceColor(env) || outputIsTty),
    animate: outputIsTty && isInteractiveStdout(),
    prompt: inputIsTty,
    hyperlinks: outputIsTty,
  }
}
