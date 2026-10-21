import type { ChannelRenderer } from '@/channels/types'
import {
  EXPANDABLE_CLOSE,
  EXPANDABLE_OPEN,
  toMarkdownV2,
} from '@/channels/adapters/telegram/markup'
import { cutByUtf16Units } from '@/channels/delivery/format'
import { ConfigError } from '@/core/errors'

// MarkdownV2 reserved characters per the Telegram Bot API style guide.
const FENCE_ESCAPE_RE = /[`\\]/g
const FENCE_RE = /```([\s\S]*?)```/g
const FENCE_MARK_RE = /```/g
const FENCE_DELIMITER = '```'
const FENCE_OVERHEAD = 6
const ENTITY_DELIMITERS = '*_~`'
/** A run of quoted lines as it appears after conversion, opened or not. */
const CHUNK_QUOTE_RUN_RE = /(?:^(?:\*\*)?>[^\n]*(?:\n|$))+/gm
const QUOTE_MARKER_LENGTH = 1
// What balanceQuotes can add to one chunk: an opener on its first run (replacing the `>`) and a
// closer on its last.
const QUOTE_BALANCE_GROWTH = EXPANDABLE_OPEN.length - QUOTE_MARKER_LENGTH + EXPANDABLE_CLOSE.length
const PIPE_TABLE_RE = /^\|.+\|\n\|[\s|:-]+\|\n(?:\|.+\|\n?)+/gm
const SEPARATOR_CELL_RE = /^:?-+:?$/
const SMALL_TABLE_MAX_COLS = 2
const SMALL_TABLE_MAX_ROWS = 4

type MarkdownSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'fence'; readonly language: string; readonly body: string }

interface EntityScan {
  readonly open: Set<string>
  link: boolean
  inFence: boolean
  blankLine: number
  newline: number
  space: number
  fenceEdge: number
}

function escapeMdv2(text: string): string {
  return renderSegments(parseSegments(text))
}

function normalizeMarkdownTables(text: string): string {
  return text.replace(PIPE_TABLE_RE, (block) => {
    const rows = block
      .trim()
      .split('\n')
      .filter((row) => !isSeparatorRow(row))
    const [headerRow, ...dataRows] = rows

    if (headerRow === undefined) {
      return block
    }

    const header = splitRow(headerRow)
    const parsedRows = dataRows.map(splitRow)

    return header.length <= SMALL_TABLE_MAX_COLS && parsedRows.length <= SMALL_TABLE_MAX_ROWS
      ? flattenSmallTable(header, parsedRows)
      : fenceLargeTable(header, parsedRows)
  })
}

// Tested per cell: every row in a matched table block is pipe-delimited, so the raw row never
// starts with the dashes themselves.
function isSeparatorRow(row: string): boolean {
  const cells = splitRow(row)

  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL_RE.test(cell))
}

function splitRow(row: string): string[] {
  const cells = row.split('|').map((cell) => cell.trim())

  if (cells[0] === '') {
    cells.shift()
  }
  if (cells[cells.length - 1] === '') {
    cells.pop()
  }

  return cells
}

function flattenSmallTable(header: readonly string[], rows: readonly string[][]): string {
  const lines: string[] = []

  for (const row of rows) {
    for (const [i, key] of header.entries()) {
      if (key) {
        lines.push(`- ${key}: ${row[i] ?? ''}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

function fenceLargeTable(header: readonly string[], rows: readonly string[][]): string {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? '').length))
  )
  const fmt = (row: readonly string[]): string =>
    row
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd()

  return ['```', fmt(header), fmt(widths.map((w) => '-'.repeat(w))), ...rows.map(fmt), '```'].join(
    '\n'
  )
}

function parseSegments(text: string): readonly MarkdownSegment[] {
  const closed = closeUnclosedFences(text)
  const segments: MarkdownSegment[] = []
  let lastIndex = 0

  for (const match of closed.matchAll(FENCE_RE)) {
    const start = match.index ?? 0

    if (start > lastIndex) {
      segments.push({ kind: 'text', value: closed.slice(lastIndex, start) })
    }

    const inner = match[1] ?? ''
    const newline = inner.indexOf('\n')

    if (newline === -1) {
      segments.push({ kind: 'fence', language: inner, body: '' })
    } else {
      segments.push({
        kind: 'fence',
        language: inner.slice(0, newline),
        body: inner.slice(newline),
      })
    }
    lastIndex = start + match[0].length
  }

  if (lastIndex < closed.length) {
    segments.push({ kind: 'text', value: closed.slice(lastIndex) })
  }

  return segments
}

function renderSegments(segments: readonly MarkdownSegment[]): string {
  return segments
    .map((segment) =>
      segment.kind === 'text' ? toMarkdownV2(segment.value) : renderFence(segment)
    )
    .join('')
}

function escapeFence(text: string): string {
  return text.replace(FENCE_ESCAPE_RE, '\\$&')
}

function renderFence(segment: MarkdownSegment & { kind: 'fence' }): string {
  return `${FENCE_DELIMITER}${escapeFence(segment.language)}${escapeFence(segment.body)}${FENCE_DELIMITER}`
}

// An odd number of ``` markers means the last fence was never closed — close it before escaping so the
// dangling block does not escape the rest of the message text.
function closeUnclosedFences(text: string): string {
  const matches = text.match(FENCE_MARK_RE)

  return matches && matches.length % 2 === 1 ? `${text}\n\`\`\`` : text
}

function chunkMdv2(text: string, maxLen: number): string[] {
  if (maxLen <= FENCE_OVERHEAD) {
    throw new ConfigError(
      `telegram renderer maxLen ${maxLen} is below the minimum fence overhead ${FENCE_OVERHEAD}`
    )
  }

  return chunkSegments(parseSegments(text), maxLen)
}

interface ChunkerState {
  chunks: string[]
  current: string
  maxLen: number
}

// Balancing can push a chunk cut at maxLen past it, so only then is the cut made short enough to
// leave room: text that already fits keeps its boundaries.
function chunkSegments(segments: readonly MarkdownSegment[], maxLen: number): string[] {
  const balanced = splitSegments(segments, maxLen).map(balanceQuotes)

  if (balanced.every((chunk) => isWithinLength(chunk, maxLen))) {
    return balanced
  }

  return splitSegments(segments, maxLen - QUOTE_BALANCE_GROWTH).map(balanceQuotes)
}

function splitSegments(segments: readonly MarkdownSegment[], maxLen: number): string[] {
  const state: ChunkerState = { chunks: [], current: '', maxLen }

  for (const segment of segments) {
    if (segment.kind === 'text') {
      appendTextChunks(state, toMarkdownV2(segment.value))
    } else {
      appendFenceChunks(state, segment)
    }
  }

  if (state.current.length > 0) {
    state.chunks.push(state.current)
  }

  return state.chunks
}

/** A chunk boundary can fall inside a quote run, leaving the opener in one message and the closer
 *  in the next: Telegram then reads a plain blockquote followed by a stray spoiler, so a fold
 *  silently stops folding on any message long enough to split. Each chunk carries its own pair.
 *
 *  A chunk holding a fence is left alone — a `>` inside code is code, not a quote. */
function balanceQuotes(chunk: string): string {
  if (chunk.includes(FENCE_DELIMITER)) {
    return chunk
  }

  return chunk.replace(CHUNK_QUOTE_RUN_RE, (run) => {
    const trailing = run.endsWith('\n') ? '\n' : ''
    const body = run.trimEnd()
    const opened = body.startsWith(EXPANDABLE_OPEN)
      ? body
      : `${EXPANDABLE_OPEN}${body.slice(QUOTE_MARKER_LENGTH)}`

    return `${opened.endsWith(EXPANDABLE_CLOSE) ? opened : `${opened}${EXPANDABLE_CLOSE}`}${trailing}`
  })
}

function appendTextChunks(state: ChunkerState, text: string): void {
  let buf = state.current + text

  while (!isWithinLength(buf, state.maxLen)) {
    const cut = safeTextCut(buf, state.maxLen)

    if (cut === 0) {
      throw new ConfigError('telegram renderer cannot split text at the configured maxLen')
    }

    state.chunks.push(buf.slice(0, cut))
    buf = buf.slice(cut)
  }

  state.current = buf
}

function safeTextCut(text: string, maxLen: number): number {
  const hard = hardTextCut(text, maxLen)
  const soft = softTextCut(text, hard)

  return soft === 0 ? hard : soft
}

function hardTextCut(text: string, maxLen: number): number {
  let cut = cutByUtf16Units(text, 0, maxLen)

  while (cut > 0) {
    let backslashes = 0

    while (backslashes < cut && text[cut - 1 - backslashes] === '\\') {
      backslashes += 1
    }

    if (backslashes % 2 === 0) {
      return cut
    }

    cut -= 1
  }

  return 0
}

/** The cut after the last blank line, else the last newline, else the last space, else the nearest
 *  fence edge, in the first `limit` units that no fence, `[label](url)` link or
 *  `*`/`_`/`~`/backtick pair open on its line spans; 0 when there is none. A fence already in the
 *  chunk is whole, so a cut inside it would leave an unclosed fence Telegram refuses to parse. */
function softTextCut(text: string, limit: number): number {
  const scan: EntityScan = {
    open: new Set(),
    link: false,
    inFence: false,
    blankLine: 0,
    newline: 0,
    space: 0,
    fenceEdge: 0,
  }

  for (let i = 0; i < limit; i += 1) {
    const char = text.charAt(i)

    if (text.startsWith(FENCE_DELIMITER, i)) {
      i = recordFenceEdge(scan, i, limit)
    } else if (char === '\\') {
      i += 1
    } else if (scan.inFence) {
      // A fence body holds no cut point and opens no entity.
    } else if (char === '\n' || char === ' ') {
      recordBoundary(scan, char, i)
    } else {
      scanEntity(scan, char)
    }
  }

  // A blank line separates whole sections, so cutting there keeps a section in one message.
  return scan.blankLine || scan.newline || scan.space || scan.fenceEdge
}

/** Returns the index of the delimiter's last unit, where the scan resumes. */
function recordFenceEdge(scan: EntityScan, index: number, limit: number): number {
  const end = index + FENCE_DELIMITER.length

  scan.inFence = !scan.inFence

  if (scan.inFence) {
    scan.fenceEdge = index
  } else if (end <= limit) {
    scan.fenceEdge = end
  }

  return end - 1
}

function recordBoundary(scan: EntityScan, char: string, index: number): void {
  if (!scan.link && scan.open.size === 0) {
    if (char === '\n') {
      // The newline before this one ended at `index`: the two make a blank line.
      if (index > 0 && scan.newline === index) {
        scan.blankLine = index + 1
      }

      scan.newline = index + 1
    } else {
      scan.space = index + 1
    }
  }

  if (char === '\n') {
    scan.open.clear()
    scan.link = false
  }
}

function scanEntity(scan: EntityScan, char: string): void {
  if (char === '[') {
    scan.link = true
  } else if (char === ')') {
    scan.link = false
  } else if (!scan.link && ENTITY_DELIMITERS.includes(char)) {
    if (!scan.open.delete(char)) {
      scan.open.add(char)
    }
  }
}

function appendFenceChunks(
  state: ChunkerState,
  segment: MarkdownSegment & { kind: 'fence' }
): void {
  const rawInner = `${segment.language}${segment.body}`
  const rendered = `${FENCE_DELIMITER}${escapeFence(rawInner)}${FENCE_DELIMITER}`

  if (isWithinLength(rendered, state.maxLen)) {
    if (state.current.length > 0 && !isWithinLength(state.current + rendered, state.maxLen)) {
      state.chunks.push(state.current)
      state.current = rendered
      return
    }

    state.current += rendered
    return
  }

  if (state.current.length > 0) {
    state.chunks.push(state.current)
    state.current = ''
  }

  const pieces = splitFence(rawInner, state.maxLen)

  for (const piece of pieces) {
    if (state.current.length > 0 && !isWithinLength(state.current + piece, state.maxLen)) {
      state.chunks.push(state.current)
      state.current = piece
    } else {
      state.current += piece
    }
  }
}

function splitFence(rawInner: string, maxLen: number): string[] {
  const pieces: string[] = []
  const capacity = maxLen - FENCE_OVERHEAD

  if (capacity < 1) {
    throw new ConfigError('telegram renderer fence capacity is too small for the configured maxLen')
  }

  let remaining = rawInner

  while (remaining.length > 0) {
    const cut = fenceCut(remaining, capacity)

    if (cut === 0) {
      throw new ConfigError('telegram renderer cannot split a fence at the configured maxLen')
    }

    pieces.push(`${FENCE_DELIMITER}${escapeFence(remaining.slice(0, cut))}${FENCE_DELIMITER}`)
    remaining = remaining.slice(cut)
  }

  return pieces
}

/** The longest prefix of `text` whose escaped form fits `capacity`; never splits a surrogate pair. */
function fenceCut(text: string, capacity: number): number {
  let size = 0
  let cut = 0

  for (const char of text) {
    const escaped = escapeFence(char).length

    if (size + escaped > capacity) {
      break
    }

    size += escaped
    cut += char.length
  }

  return cut
}

function isWithinLength(text: string, maxLen: number): boolean {
  return cutByUtf16Units(text, 0, maxLen) === text.length
}

export const telegramMarkdownV2Renderer: ChannelRenderer = {
  escape: escapeMdv2,
  normalizeTables: normalizeMarkdownTables,
  chunk: chunkMdv2,
}
