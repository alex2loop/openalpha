import { terminalWidth } from '@/cli/env'
import { colors } from '@/cli/ui/colors'
import { formatTerminalLink, isLinkableUrl } from '@/cli/ui/terminal-links'
import { sanitizeDisplayText } from '@/core/utils/text'

const INLINE_TOKEN_RE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g
const FENCE_RE = /^\s*```/
const TABLE_DIVIDER_CELL_RE = /^:?-{3,}:?$/
const WHITESPACE_RE = /\s+/

type InlineStyle = 'bold' | 'code' | 'italic' | 'plain'

interface InlineSegment {
  readonly text: string
  readonly style: InlineStyle
}

interface MarkdownState {
  pending: string
  inFence: boolean
  tableLines: string[] | null
}

interface LineRenderer {
  emitLine(line: string): void
  flushTable(): void
}

interface TableLineAppend {
  readonly state: MarkdownState
  readonly line: string
  readonly flushTable: () => void
  readonly emitLine: (line: string) => void
}

interface WrapState {
  readonly lines: string[]
  current: string
  currentWidth: number
  /** Whether whitespace stood between the last word and the next one in the source line. */
  spaced: boolean
  readonly width: number
  readonly hyperlinks: boolean
}

interface MarkdownStream {
  write(chunk: string): void
  flush(): void
}

interface MarkdownStreamOptions {
  /** Decorate validated HTTP(S) plain-text URLs with OSC 8 sequences; visible bytes are unchanged. */
  readonly hyperlinks?: boolean
}

export function createMarkdownStream(
  write: (text: string) => void,
  options: MarkdownStreamOptions = {}
): MarkdownStream {
  const state: MarkdownState = { pending: '', inFence: false, tableLines: null }
  const renderer = createLineRenderer(write, state, options.hyperlinks === true)

  return {
    write(chunk): void {
      state.pending += chunk
      consumeCompletedLines(state, renderer)
    },

    flush(): void {
      flushMarkdown(state, renderer)
    },
  }
}

function createLineRenderer(
  write: (text: string) => void,
  state: MarkdownState,
  hyperlinks: boolean
): LineRenderer {
  const flushTable = (): void => {
    if (state.tableLines === null) {
      return
    }

    const lines = state.tableLines
    state.tableLines = null

    if (isCompleteTable(lines)) {
      write(`${renderTable(lines)}\n`)

      return
    }

    for (const line of lines) {
      write(`${renderProse(line, hyperlinks)}\n`)
    }
  }

  // Model text is untrusted: escape sequences are stripped here, before the renderer adds its own.
  const emitLine = (raw: string): void => {
    const line = sanitizeDisplayText(raw)

    if (state.inFence) {
      write(`${colors.dim(line)}\n`)
      state.inFence = !FENCE_RE.test(line)

      return
    }

    if (FENCE_RE.test(line)) {
      flushTable()
      state.inFence = true
      write(`${colors.dim(line)}\n`)

      return
    }

    if (state.tableLines !== null) {
      appendTableLine({ state, line, flushTable, emitLine })

      return
    }

    if (isTableLine(line)) {
      state.tableLines = [line]

      return
    }

    write(`${renderProse(line, hyperlinks)}\n`)
  }

  return { emitLine, flushTable }
}

function appendTableLine(options: TableLineAppend): void {
  if (isTableLine(options.line)) {
    options.state.tableLines?.push(options.line)

    return
  }

  options.flushTable()
  options.emitLine(options.line)
}

function consumeCompletedLines(state: MarkdownState, renderer: LineRenderer): void {
  for (;;) {
    const newline = state.pending.indexOf('\n')

    if (newline === -1) {
      return
    }

    const line = state.pending.slice(0, newline)
    state.pending = state.pending.slice(newline + 1)
    renderer.emitLine(line.endsWith('\r') ? line.slice(0, -1) : line)
  }
}

function flushMarkdown(state: MarkdownState, renderer: LineRenderer): void {
  if (state.pending !== '') {
    renderer.emitLine(state.pending)
    state.pending = ''
  }

  renderer.flushTable()
  state.inFence = false
}

function renderProse(line: string, hyperlinks: boolean): string {
  if (line.startsWith('# ')) {
    return colors.bold(wrapInline(line.slice(2), hyperlinks))
  }

  return wrapInline(line, hyperlinks)
}

function wrapInline(line: string, hyperlinks: boolean): string {
  const state: WrapState = {
    lines: [],
    current: '',
    currentWidth: 0,
    spaced: false,
    width: terminalWidth(),
    hyperlinks,
  }

  for (const segment of parseInline(line)) {
    appendInlineSegment(state, segment)
  }

  if (state.current !== '') {
    state.lines.push(state.current)
  }

  return state.lines.join('\n')
}

/** A split leaves an empty word at each edge that touches whitespace, so every word after the
 *  first, empty or not, marks a gap. A word with no gap before it, like the colon after
 *  `**bold**:`, joins the previous one instead of gaining a space. */
function appendInlineSegment(state: WrapState, segment: InlineSegment): void {
  for (const [index, word] of segment.text.split(WHITESPACE_RE).entries()) {
    state.spaced ||= index > 0

    if (word !== '') {
      // Width comes from the raw word: an OSC 8 wrapper adds escape bytes the terminal ignores.
      appendWord(state, displayWord(word, segment.style, state.hyperlinks), Bun.stringWidth(word))
      state.spaced = false
    }
  }
}

function appendWord(state: WrapState, word: string, wordWidth: number): void {
  if (!state.spaced && state.currentWidth > 0) {
    state.current += word
    state.currentWidth += wordWidth

    return
  }

  if (state.currentWidth > 0 && state.currentWidth + 1 + wordWidth > state.width) {
    state.lines.push(state.current)
    state.current = word
    state.currentWidth = wordWidth

    return
  }

  state.current += state.currentWidth === 0 ? word : ` ${word}`
  state.currentWidth += state.currentWidth === 0 ? wordWidth : wordWidth + 1
}

function displayWord(word: string, style: InlineStyle, hyperlinks: boolean): string {
  if (hyperlinks && style === 'plain' && isLinkableUrl(word)) {
    return formatTerminalLink(word, true)
  }

  return applyInlineStyle(word, style)
}

function parseInline(line: string): readonly InlineSegment[] {
  return line.split(INLINE_TOKEN_RE).flatMap((token) => {
    if (token === '') {
      return []
    }

    return [{ text: stripInlineMarkers(token), style: inlineStyle(token) }]
  })
}

function renderInline(line: string): string {
  return parseInline(line)
    .map((segment) => applyInlineStyle(segment.text, segment.style))
    .join('')
}

function inlineStyle(token: string): InlineStyle {
  if (token.startsWith('**') && token.endsWith('**')) {
    return 'bold'
  }

  if (token.startsWith('`') && token.endsWith('`')) {
    return 'code'
  }

  if (token.startsWith('*') && token.endsWith('*')) {
    return 'italic'
  }

  return 'plain'
}

function stripInlineMarkers(token: string): string {
  const style = inlineStyle(token)

  if (style === 'bold') {
    return token.slice(2, -2)
  }

  if (style === 'plain') {
    return token
  }

  return token.slice(1, -1)
}

function applyInlineStyle(text: string, style: InlineStyle): string {
  if (style === 'bold') {
    return colors.bold(text)
  }

  if (style === 'code') {
    return colors.cyan(text)
  }

  return style === 'italic' ? colors.italic(text) : text
}

function isTableLine(line: string): boolean {
  return tableCells(line).length > 1
}

function isCompleteTable(lines: readonly string[]): boolean {
  const divider = lines[1]
  const cells = divider === undefined ? [] : tableCells(divider)

  return cells.length > 1 && cells.every((cell) => TABLE_DIVIDER_CELL_RE.test(cell))
}

/** A grid padded past the terminal wraps mid-cell, and every column below the wrap stops lining
 *  up — the shape that carried the meaning is the first thing lost. Too narrow, each row becomes
 *  its own block instead, labelled by the header. Nothing is truncated: a board is data, and a
 *  clipped price reads as a different number. */
function renderTable(lines: readonly string[]): string {
  const header = tableCells(lines[0] ?? '')
  const rows = lines.slice(2).map((line) => tableCells(line))
  const widths = tableWidths([header, ...rows])

  return gridWidth(widths) > terminalWidth()
    ? rows.map((row) => stackedRow(header, row)).join('\n\n')
    : renderGrid(header, rows, widths)
}

/** `| a | b |`: two characters at each edge and three between every pair. */
function gridWidth(widths: readonly number[]): number {
  return widths.reduce((total, width) => total + width, 0) + 3 * widths.length + 1
}

function renderGrid(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  widths: readonly number[]
): string {
  const divider = widths.map((width) => '-'.repeat(Math.max(3, width)))
  const rendered = [
    formatTableRow(header, widths, 'bold'),
    formatTableRow(divider, widths, 'plain'),
  ]

  for (const row of rows) {
    rendered.push(formatTableRow(row, widths, 'plain'))
  }

  return rendered.join('\n')
}

/** The first cell names the row, so it leads unlabelled; an empty cell is dropped rather than
 *  printed as a label with nothing after it. */
function stackedRow(header: readonly string[], row: readonly string[]): string {
  const fields = header.slice(1).flatMap((label, index) => {
    const cell = row[index + 1] ?? ''

    return cell === '' ? [] : [`  ${colors.dim(renderInline(label))}: ${renderInline(cell)}`]
  })

  return [colors.bold(renderInline(row[0] ?? '')), ...fields].join('\n')
}

function tableCells(line: string): readonly string[] {
  const trimmed = line.trim()
  const cells = trimmed.split('|').map((cell) => cell.trim())
  const start = trimmed.startsWith('|') ? 1 : 0
  const end = trimmed.endsWith('|') ? cells.length - 1 : cells.length

  return cells.slice(start, end)
}

function tableWidths(rows: readonly (readonly string[])[]): readonly number[] {
  const widths: number[] = []

  for (const row of rows) {
    for (const [index, cell] of row.entries()) {
      widths[index] = Math.max(widths[index] ?? 0, Bun.stringWidth(renderInline(cell)))
    }
  }

  return widths
}

function formatTableRow(
  cells: readonly string[],
  widths: readonly number[],
  style: InlineStyle
): string {
  const formatted = widths.map((width, index) => {
    const cell = cells[index] ?? ''
    const rendered = style === 'bold' ? colors.bold(renderInline(cell)) : renderInline(cell)

    return padVisible(rendered, width)
  })

  return `| ${formatted.join(' | ')} |`
}

function padVisible(text: string, width: number): string {
  return `${text}${' '.repeat(Math.max(0, width - Bun.stringWidth(text)))}`
}
