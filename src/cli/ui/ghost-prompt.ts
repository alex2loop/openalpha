import type { Key } from 'node:readline'
import type { createInterface } from 'node:readline/promises'

import type { Terminal } from '@/cli/terminal'
import type { CompletionSource } from '@/cli/types'
import { stripControls } from '@/core/utils/text'

import { truncateDisplay } from './format'

const CLEAR_SCREEN_DOWN = '\u001B[0J'
const CLEAR_TO_LINE_END = '\u001B[0m\u001B[K'
const COMPLETION_TOKEN_RE = /\S+$/
const DIM_TEXT = '\u001B[2m'
const MIN_COLUMNS = 1
const RESTORE_CURSOR = '\u001B[u'
const SAVE_CURSOR = '\u001B[s'
const TRAILING_WHITESPACE_RE = /\s$/

interface GhostSuggestions {
  beginPlainQuestion(prompt: string): void
  beginSuggestedQuestion(prompt: string): void
  close(): void
  finishQuestion(): void
  lineOutput(write: () => void): void
  rawOutput(chunk: string, write: () => void): void
}

const INERT_GHOST: GhostSuggestions = {
  beginPlainQuestion: () => undefined,
  beginSuggestedQuestion: () => undefined,
  close: () => undefined,
  finishQuestion: () => undefined,
  lineOutput: (write) => write(),
  rawOutput: (_chunk, write) => write(),
}

interface GhostState {
  readonly terminal: Terminal
  acceptedSuffix: string
  closed: boolean
  prompt: string
  promptSuspended: boolean
  questionActive: boolean
  rawNeedsNewline: boolean
  renderedSuffix: string
  suggestionsActive: boolean
}

interface GhostPromptOptions {
  readonly redraw: () => void
  readonly rl: ReturnType<typeof createInterface>
  readonly state: GhostState
}

interface GhostLineOutputOptions extends GhostPromptOptions {
  readonly write: () => void
}

interface GhostRawOutputOptions extends GhostLineOutputOptions {
  readonly chunk: string
}

interface GhostCloseOptions {
  readonly state: GhostState
  readonly onKeypress: (character: string | undefined, key: Key) => void
  readonly onResize: () => void
}

export function createGhostSuggestions(
  terminal: Terminal,
  rl: ReturnType<typeof createInterface>,
  completion?: CompletionSource
): GhostSuggestions {
  if (!isInteractiveTerminal(terminal)) {
    return INERT_GHOST
  }

  const state: GhostState = {
    terminal,
    acceptedSuffix: '',
    closed: false,
    prompt: '',
    promptSuspended: false,
    questionActive: false,
    rawNeedsNewline: false,
    renderedSuffix: '',
    suggestionsActive: false,
  }
  const redraw = (): void => queueMicrotask(() => renderGhost(state, rl, completion))
  const onKeypress = (_character: string | undefined, key: Key): void => {
    resumeSuspendedPrompt({ redraw, rl, state })
    handleGhostKeypress({ redraw, rl, state }, key)
  }
  const onResize = (): void => {
    if (state.promptSuspended) {
      resumeSuspendedPrompt({ redraw, rl, state })
      return
    }

    redraw()
  }

  terminal.stdin.prependListener('keypress', onKeypress)
  terminal.stdout.prependListener('resize', onResize)

  return {
    beginPlainQuestion: (prompt) => beginQuestion(state, prompt),
    beginSuggestedQuestion: (prompt) => beginSuggestedQuestion(state, prompt, redraw),
    close: () => closeGhost({ state, onKeypress, onResize }),
    finishQuestion: () => finishQuestion(state),
    lineOutput: (write) => lineOutputWhilePrompted({ redraw, rl, state, write }),
    rawOutput: (chunk, write) => rawOutputWhilePrompted({ chunk, redraw, rl, state, write }),
  }
}

export function isInteractiveTerminal(terminal: Terminal): boolean {
  return terminal.stdin.isTTY === true && terminal.stdout.isTTY === true
}

export function completionToken(line: string): string {
  if (TRAILING_WHITESPACE_RE.test(line)) {
    return ''
  }

  return line.match(COMPLETION_TOKEN_RE)?.[0] ?? ''
}

function renderGhost(
  state: GhostState,
  rl: ReturnType<typeof createInterface>,
  completion?: CompletionSource
): void {
  if (state.promptSuspended) {
    return
  }

  clearGhost(state)
  state.acceptedSuffix = ''

  if (completion === undefined || !state.suggestionsActive || rl.cursor !== rl.line.length) {
    return
  }

  state.acceptedSuffix = suggestionSuffix(rl.line, completion)
  const { columns: width } = state.terminal.stdout
  const columns = Number.isFinite(width) ? width : MIN_COLUMNS
  const remainingColumns = Math.max(MIN_COLUMNS, columns - rl.getCursorPos().cols - 1)
  state.renderedSuffix = truncateDisplay(state.acceptedSuffix, remainingColumns)

  if (state.renderedSuffix === '') {
    return
  }

  state.terminal.stdout.write(
    `${SAVE_CURSOR}${DIM_TEXT}${state.renderedSuffix}${CLEAR_TO_LINE_END}${RESTORE_CURSOR}`
  )
}

function handleGhostKeypress(options: GhostPromptOptions, key: Key): void {
  if (options.state.suggestionsActive && key.name === 'f2' && options.state.acceptedSuffix !== '') {
    const accepted = options.state.acceptedSuffix

    clearGhost(options.state)
    options.state.acceptedSuffix = ''
    options.rl.write(accepted)
    return
  }

  options.redraw()
}

function beginQuestion(state: GhostState, prompt: string): void {
  state.prompt = prompt
  state.promptSuspended = false
  state.questionActive = true
  state.rawNeedsNewline = false
  state.suggestionsActive = false
  state.acceptedSuffix = ''
}

function beginSuggestedQuestion(state: GhostState, prompt: string, redraw: () => void): void {
  beginQuestion(state, prompt)
  state.suggestionsActive = true
  redraw()
}

function finishQuestion(state: GhostState): void {
  finishRawOutput(state)
  state.questionActive = false
  state.suggestionsActive = false
  state.acceptedSuffix = ''
  state.prompt = ''
  clearGhost(state)
}

function lineOutputWhilePrompted(options: GhostLineOutputOptions): void {
  if (!options.state.questionActive || options.state.closed) {
    options.write()
    return
  }

  if (options.state.promptSuspended) {
    finishRawOutput(options.state)
  } else {
    clearPromptLine(options.state, options.rl)
  }

  try {
    options.write()
  } finally {
    restorePromptLine(options.state, options.rl)
    options.redraw()
  }
}

function rawOutputWhilePrompted(options: GhostRawOutputOptions): void {
  if (!options.state.questionActive || options.state.closed) {
    options.write()
    return
  }

  if (!options.state.promptSuspended) {
    clearPromptLine(options.state, options.rl)
    options.state.promptSuspended = true
  }

  try {
    options.write()
  } finally {
    if (options.chunk !== '') {
      options.state.rawNeedsNewline = !options.chunk.endsWith('\n')
    }
  }
}

function resumeSuspendedPrompt(options: GhostPromptOptions): void {
  if (!options.state.promptSuspended) {
    return
  }

  finishRawOutput(options.state)
  restorePromptLine(options.state, options.rl)
  options.redraw()
}

function finishRawOutput(state: GhostState): void {
  if (!state.promptSuspended) {
    return
  }

  if (state.rawNeedsNewline) {
    state.terminal.stdout.write('\n')
  }

  state.promptSuspended = false
  state.rawNeedsNewline = false
}

function clearPromptLine(state: GhostState, rl: ReturnType<typeof createInterface>): void {
  clearGhost(state)
  const { rows } = rl.getCursorPos()
  const moveUp = rows === 0 ? '' : `\u001B[${rows}A`

  state.terminal.stdout.write(`\r${moveUp}${CLEAR_SCREEN_DOWN}`)
}

function restorePromptLine(state: GhostState, rl: ReturnType<typeof createInterface>): void {
  const beforeCursor = rl.line.slice(0, rl.cursor)
  const afterCursor = rl.line.slice(rl.cursor)

  state.terminal.stdout.write(
    `${state.prompt}${beforeCursor}${SAVE_CURSOR}${afterCursor}${RESTORE_CURSOR}`
  )
}

function closeGhost(options: GhostCloseOptions): void {
  const { state, onKeypress, onResize } = options

  if (state.closed) {
    return
  }

  state.closed = true
  finishQuestion(state)
  state.terminal.stdin.off('keypress', onKeypress)
  state.terminal.stdout.off('resize', onResize)
}

function clearGhost(state: GhostState): void {
  if (state.renderedSuffix === '') {
    return
  }

  state.terminal.stdout.write(CLEAR_TO_LINE_END)
  state.renderedSuffix = ''
}

function suggestionSuffix(line: string, completion: CompletionSource): string {
  const token = completionToken(line)
  const candidate = completion.complete(line).find((value) => value.startsWith(token))

  return candidate === undefined ? '' : stripControls(candidate.slice(token.length))
}
