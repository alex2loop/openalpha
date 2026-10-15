const UTF8_RE = /utf-?8/i
const TERMINAL_WIDTH_FALLBACK = 80
const MIN_TERMINAL_WIDTH = 20
// VISUAL names the full-screen editor and wins over EDITOR, the line editor, by convention.
const EDITOR_ENV_NAMES = ['VISUAL', 'EDITOR'] as const

let quiet = false
let verbose = false
let noColor = false

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

export function setNoColor(on: boolean): void {
  noColor = on
}

export function getEnv(): Record<string, string | undefined> {
  return process.env
}

export function editorFromEnv(): string | undefined {
  for (const name of EDITOR_ENV_NAMES) {
    const value = process.env[name]

    if (value !== undefined && value.trim() !== '') {
      return value
    }
  }

  return undefined
}

export function isNoColor(): boolean {
  if (noColor) {
    return true
  }

  if (process.env.NO_COLOR !== undefined) {
    return true
  }

  if (isForceColor()) {
    return false
  }

  return !process.stdout.isTTY
}

function isForceColor(): boolean {
  const forced = process.env.FORCE_COLOR

  return forced !== undefined && forced !== '0'
}

export function isInteractiveStdin(): boolean {
  return process.stdin.isTTY === true
}

export function isInteractiveStdout(): boolean {
  if (process.stdout.isTTY !== true) {
    return false
  }

  // Captured streams flatten cursor redraws into one line per frame — no transient animation there.
  return (
    process.env.TERM !== 'dumb' &&
    process.env.CI === undefined &&
    process.env.NO_COLOR === undefined
  )
}

export function isInteractiveStderr(): boolean {
  return process.stderr.isTTY === true && process.env.CI === undefined
}

export function isUnicode(): boolean {
  const locale = process.env.LC_ALL ?? process.env.LC_CTYPE ?? process.env.LANG ?? ''

  return UTF8_RE.test(locale)
}

export function terminalWidth(): number {
  const columns = process.stdout.columns

  if (columns === undefined || !Number.isFinite(columns)) {
    return TERMINAL_WIDTH_FALLBACK
  }

  return Math.max(MIN_TERMINAL_WIDTH, columns)
}

export function isQuiet(): boolean {
  return quiet
}

export function setQuiet(on: boolean): void {
  quiet = on
}

export function isVerbose(): boolean {
  return verbose
}

export function setVerbose(on: boolean): void {
  verbose = on
}

// Per-stream policy: NO_COLOR always disables color; FORCE_COLOR may enable color only (never
// animation, prompting, paging, or hyperlinks). Stdin controls prompting; the target output stream
// controls animation and hyperlinks. Resolving each stream independently lets one process write a
// colored, link-decorated TTY report while paging through a pipe-friendly fallback.
export function resolveTerminalPolicy(streams: TerminalStreams): TerminalPolicy {
  const outputIsTty = streams.output.isTTY === true
  const inputIsTty = streams.input.isTTY === true
  const colorDisabled = noColor || process.env.NO_COLOR !== undefined

  return {
    color: !colorDisabled && (isForceColor() || outputIsTty),
    animate: outputIsTty && isInteractiveStdout(),
    prompt: inputIsTty,
    hyperlinks: outputIsTty,
  }
}
