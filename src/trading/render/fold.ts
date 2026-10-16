import { INDENT } from '@/trading/render/layout'

const QUOTE_PREFIX = '> '
const EMPHASIS_RE = /\*\*([^*\n]+)\*\*/g
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g
const QUOTE_PREFIX_RE = /^> ?/
const FENCED_BLOCK_RE = /(```[\s\S]*?```)/
const INDENT_RE = /^(?: {2})*/
const INDENT_WIDTH = 2
const SECTION_TITLE_RE = /^(\S+) \*\*(.+)\*\*$/
const FOLD_TITLE_RE = /^\*\*[^*]+\*\*$/
const HEADING_PREFIX = '### '
const BULLET = '- '

/** A named block of detail the destination may fold away. Telegram turns the run into an expandable
 *  blockquote the reader taps open; the plain channels and the terminal strip the markers and print
 *  the detail inline under an indented title, which is what a scrollable surface wants anyway.
 *
 *  A fold hides detail, never a decision: a stop, a target, a size, a warning and a refusal reason
 *  all stay outside one. */
export function toFoldLines(title: string, body: readonly string[]): readonly string[] {
  if (body.length === 0) {
    return []
  }

  return [`**${title}**`, ...body.map((line) => `${QUOTE_PREFIX}${line}`)]
}

/** Exactly what the trading surface emits, removed for a destination that renders none of it.
 *  Deliberately narrower than the channel stripper: that one also eats a literal `*` out of a row,
 *  and rewrites a link to `label (url)` - which reinstates the redirect target a citation exists to
 *  keep off the page. */
export function toPlainText(text: string): string {
  // A fenced block is quoted text shown exactly as written, never the surface's own markup.
  return text
    .split(FENCED_BLOCK_RE)
    .map((part) => (FENCED_BLOCK_RE.test(part) ? part : stripSurfaceMarkup(part)))
    .join('')
}

function stripSurfaceMarkup(text: string): string {
  const lines = text.split('\n')

  return lines
    .map((line, index) => plainFoldLine(line, lines[index + 1]))
    .join('\n')
    .replace(EMPHASIS_RE, '$1')
    .replace(LINK_RE, '$1')
}

/** A fold sits inside the section above it, so its title takes a row's indent and its detail the
 *  level under that. */
function plainFoldLine(line: string, next: string | undefined): string {
  if (line.startsWith(QUOTE_PREFIX.trimEnd())) {
    return `${INDENT[1]}${quotedRow(line.replace(QUOTE_PREFIX_RE, ''))}`
  }

  return isFoldLine(line, next) ? `${INDENT[1]}${line}` : line
}

/** The same text for a destination that renders markdown, where a single newline joins two lines
 *  and indentation means nothing: a section title becomes a heading, an indented row a bullet at
 *  its depth, and a fold's quoted detail bullets under its bold title - a quote marker is escaped
 *  on its way through a tool result. Anything else stands as its own paragraph. */
export function toMarkdownText(text: string): string {
  const lines: string[] = []

  for (const line of text.split('\n')) {
    const body = line.startsWith(QUOTE_PREFIX) ? quotedRow(line.slice(QUOTE_PREFIX.length)) : line
    const indent = INDENT_RE.exec(body)?.[0].length ?? 0
    const content = body.slice(indent)

    if (content === '') {
      lines.push('')
    } else if (indent > 0) {
      lines.push(`${' '.repeat(indent - INDENT_WIDTH)}${BULLET}${content}`)
    } else {
      lines.push(...paragraphBreak(lines), toParagraph(content))
    }
  }

  return lines.join('\n')
}

/** A fold's detail sits one level under its title, unless it already carries its own indent. */
function quotedRow(content: string): string {
  return content.startsWith(INDENT[1]) ? content : `${INDENT[1]}${content}`
}

function toParagraph(content: string): string {
  const title = SECTION_TITLE_RE.exec(content)

  return title === null ? content : `${HEADING_PREFIX}${title[1]} ${title[2]}`
}

/** A top-level line directly under another line would join it, or continue the list item above. */
function paragraphBreak(lines: readonly string[]): readonly string[] {
  return lines.length > 0 && lines.at(-1) !== '' ? [''] : []
}

/** The text without its folds, for a reader who can ask for the detail another way. Safe to drop
 *  by construction: a fold holds detail, never a decision. */
export function withoutFolds(text: string): string {
  const lines = text.split('\n')

  return lines.filter((line, index) => !isFoldLine(line, lines[index + 1])).join('\n')
}

function isFoldLine(line: string, next: string | undefined): boolean {
  return (
    line.startsWith(QUOTE_PREFIX) ||
    (FOLD_TITLE_RE.test(line) && next?.startsWith(QUOTE_PREFIX) === true)
  )
}
