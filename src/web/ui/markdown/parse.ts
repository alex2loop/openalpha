import { isSourcesTitle } from '@/web/text/sources-title'
import { type Inline, parseInline, toPlain } from '@/web/ui/markdown/inline'

// Every scan is bounded so no input can freeze the page: a longer report is cut, a line longer than
// `LINE_MAX_CHARS` is paragraph text before any pattern sees it (inline runs are bounded in
// `inline.ts`).
const REPORT_MAX_CHARS = 200_000
const LINE_MAX_CHARS = 4_000
const HEADING_ID_PREFIX = 'rh'
const SOURCE_ID_PREFIX = 'rs'
const HEADING = /^(#{1,6})\s+(\S.*)$/
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^\s*>\s?(.*)$/
// A bullet, a number, or a `[n]` footnote line.
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)]|\[\d{1,3}\])\s+(.*)$/
const TABLE_ROW = /^\s*\|/
const DIVIDER_CELL = /^:?-+:?$/
const NUMBER_MARKER = /\d+/
const BULLET_MARKER = /^[-*+]$/
const INDENTED = /^\s/
const LEADING_PIPE = /^\|/
const TRAILING_PIPE = /\|$/
const LINE_BREAK = /\r\n?/g

interface ListItem {
  /** The number the line wrote (`3.` or `[3]`); absent on a bullet. */
  readonly n?: number
  readonly inline: readonly Inline[]
  readonly sub?: ListBlock
}

interface ListBlock {
  readonly kind: 'list'
  readonly ordered: boolean
  readonly items: readonly ListItem[]
}

export type Block =
  | {
      readonly kind: 'heading'
      readonly level: number
      readonly id: string
      readonly inline: readonly Inline[]
    }
  | { readonly kind: 'paragraph'; readonly inline: readonly Inline[] }
  | ListBlock
  | {
      readonly kind: 'table'
      readonly head: readonly (readonly Inline[])[]
      readonly rows: readonly (readonly (readonly Inline[])[])[]
    }
  | { readonly kind: 'quote'; readonly inline: readonly Inline[] }
  | { readonly kind: 'rule' }

export interface ReportSource {
  readonly n: number
  readonly text: string
  readonly url?: string
}

export interface ReportDoc {
  readonly blocks: readonly Block[]
  readonly headings: readonly {
    readonly id: string
    readonly level: number
    readonly text: string
  }[]
  readonly sources: readonly ReportSource[]
  /** The text was longer than the parser reads, so the end is missing. */
  readonly isTruncated: boolean
}

interface Taken {
  readonly block: Block
  readonly next: number
}

/** Reads markdown into blocks, a table of contents and the numbered sources a footnote jumps to. It
 *  never throws: what it cannot read stays a paragraph. No HTML passes through, and a link is kept
 *  only when its address is `http:` or `https:`. */
export function parseReport(text: string): ReportDoc {
  const lines = text.slice(0, REPORT_MAX_CHARS).replace(LINE_BREAK, '\n').split('\n')
  const { blocks, sources } = splitSources(parseBlocks(lines))
  const numbered = blocks.map(numberHeading())

  return {
    blocks: numbered,
    headings: numbered.flatMap((block) =>
      block.kind === 'heading'
        ? [{ id: block.id, level: block.level, text: toPlain(block.inline) }]
        : []
    ),
    sources,
    isTruncated: text.length > REPORT_MAX_CHARS,
  }
}

/** The element id of source `n`, which a `[n]` mark jumps to. A `scope` keeps the ids of one chat
 *  answer apart from another's. */
export function sourceAnchor(n: number, scope?: string): string {
  return scope === undefined ? `${SOURCE_ID_PREFIX}${n}` : `${SOURCE_ID_PREFIX}-${scope}-${n}`
}

/** Every word of the report, for finding the names it mentions. */
export function plainTextOf(doc: ReportDoc): string {
  return doc.blocks.map(blockPlain).join('\n')
}

function blockPlain(block: Block): string {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'quote':
      return toPlain(block.inline)
    case 'list':
      return block.items.map(itemPlain).join('\n')
    case 'table':
      return [...block.head, ...block.rows.flat()].map(toPlain).join(' ')
    case 'rule':
      return ''
  }
}

function itemPlain(item: ListItem): string {
  return [toPlain(item.inline), item.sub === undefined ? '' : blockPlain(item.sub)].join('\n')
}

function parseBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    if ((lines[index] ?? '').trim() === '') {
      index++
      continue
    }

    const taken = takeBlock(lines, index)

    blocks.push(taken.block)
    index = taken.next
  }

  return blocks
}

// Always takes at least the line at `index`, so the caller's loop ends.
function takeBlock(lines: readonly string[], index: number): Taken {
  const line = lines[index] ?? ''
  const heading = execLine(HEADING, line)

  if (heading !== null) {
    const [, marks = '', text = ''] = heading

    return {
      block: {
        kind: 'heading',
        level: marks.length,
        id: '',
        inline: parseInline(trimHeadingTail(text)),
      },
      next: index + 1,
    }
  }

  if (testLine(RULE, line)) {
    return { block: { kind: 'rule' }, next: index + 1 }
  }

  if (testLine(TABLE_ROW, line) && isTableDivider(lines[index + 1] ?? '')) {
    return takeTable(lines, index)
  }

  if (testLine(QUOTE, line)) {
    return takeQuote(lines, index)
  }

  return testLine(LIST_ITEM, line) ? takeList(lines, index) : takeParagraph(lines, index)
}

function testLine(pattern: RegExp, line: string): boolean {
  return line.length <= LINE_MAX_CHARS && pattern.test(line)
}

function execLine(pattern: RegExp, line: string): RegExpExecArray | null {
  return line.length <= LINE_MAX_CHARS ? pattern.exec(line) : null
}

// A closing run of `#` and the spaces around it are not part of the heading.
function trimHeadingTail(text: string): string {
  let end = text.trimEnd().length

  while (end > 0 && text[end - 1] === '#') {
    end--
  }

  return text.slice(0, end).trimEnd()
}

// Each cell is dashes with optional colons; tested cell by cell so no pattern backtracks over a line.
function isTableDivider(line: string): boolean {
  if (line.length > LINE_MAX_CHARS) {
    return false
  }

  const cells = line.trim().replace(LEADING_PIPE, '').replace(TRAILING_PIPE, '').split('|')

  return cells.every((cell) => DIVIDER_CELL.test(cell.trim()))
}

function startsBlock(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? ''

  return (
    line.trim() === '' ||
    testLine(HEADING, line) ||
    testLine(RULE, line) ||
    testLine(QUOTE, line) ||
    testLine(LIST_ITEM, line) ||
    (testLine(TABLE_ROW, line) && isTableDivider(lines[index + 1] ?? ''))
  )
}

function takeParagraph(lines: readonly string[], index: number): Taken {
  let end = index + 1

  while (end < lines.length && !startsBlock(lines, end)) {
    end++
  }

  return {
    block: { kind: 'paragraph', inline: parseInline(joinLines(lines.slice(index, end), '\n')) },
    next: end,
  }
}

function takeQuote(lines: readonly string[], index: number): Taken {
  const quoted: string[] = []
  let end = index
  let match = execLine(QUOTE, lines[end] ?? '')

  while (match !== null) {
    quoted.push(match[1] ?? '')
    end++
    match = execLine(QUOTE, lines[end] ?? '')
  }

  return { block: { kind: 'quote', inline: parseInline(joinLines(quoted, '\n')) }, next: end }
}

function takeTable(lines: readonly string[], index: number): Taken {
  const rows: (readonly (readonly Inline[])[])[] = []
  let end = index + 2

  while (end < lines.length && testLine(TABLE_ROW, lines[end] ?? '')) {
    rows.push(splitRow(lines[end] ?? ''))
    end++
  }

  return { block: { kind: 'table', head: splitRow(lines[index] ?? ''), rows }, next: end }
}

function splitRow(line: string): readonly (readonly Inline[])[] {
  return line
    .trim()
    .replace(LEADING_PIPE, '')
    .replace(TRAILING_PIPE, '')
    .split('|')
    .map((cell) => parseInline(cell.trim()))
}

// A list takes every following bullet, number or indented line.
function takeList(lines: readonly string[], index: number): Taken {
  let end = index + 1

  while (end < lines.length && isListLine(lines[end] ?? '')) {
    end++
  }

  return { block: buildList(lines.slice(index, end)), next: end }
}

function isListLine(line: string): boolean {
  return testLine(LIST_ITEM, line) || (line.trim() !== '' && INDENTED.test(line))
}

function buildList(lines: readonly string[]): ListBlock {
  const first = execLine(LIST_ITEM, lines[0] ?? '')
  const baseIndent = first?.[1]?.length ?? 0
  const groups: string[][] = []

  for (const line of lines) {
    const item = execLine(LIST_ITEM, line)

    if (item !== null && (item[1]?.length ?? 0) <= baseIndent) {
      groups.push([line])
    } else {
      groups.at(-1)?.push(line)
    }
  }

  return {
    kind: 'list',
    ordered: !BULLET_MARKER.test(first?.[2] ?? ''),
    items: groups.map(buildItem),
  }
}

function buildItem(group: readonly string[]): ListItem {
  const [head = '', ...rest] = group
  const match = execLine(LIST_ITEM, head)
  const marker = match?.[2] ?? ''
  const nestedAt = rest.findIndex((line) => testLine(LIST_ITEM, line))
  const continued = nestedAt === -1 ? rest : rest.slice(0, nestedAt)
  const nested = nestedAt === -1 ? [] : rest.slice(nestedAt)
  const text = joinLines([match?.[3] ?? '', ...continued.map((line) => line.trim())], ' ')
  const written = NUMBER_MARKER.exec(marker)

  return {
    ...(written === null ? {} : { n: Number.parseInt(written[0], 10) }),
    inline: parseInline(text),
    ...(nested.length === 0 ? {} : { sub: buildList(nested) }),
  }
}

function joinLines(lines: readonly string[], separator: string): string {
  return lines.map((line) => line.trimEnd()).join(separator)
}

function numberHeading(): (block: Block) => Block {
  let count = 0

  return (block) => {
    if (block.kind !== 'heading') {
      return block
    }

    count++

    return { ...block, id: `${HEADING_ID_PREFIX}${count}` }
  }
}

// The last heading that names the report's sources, with the list under it, becomes `sources`
// and leaves the body; a heading with no list under it stays where it is.
function splitSources(blocks: readonly Block[]): {
  readonly blocks: readonly Block[]
  readonly sources: readonly ReportSource[]
} {
  const at = blocks.findLastIndex(isSourcesHeading)

  if (at === -1) {
    return { blocks, sources: [] }
  }

  const heading = blocks[at]
  const level = heading?.kind === 'heading' ? heading.level : 0
  const after = blocks.slice(at + 1)
  const stop = after.findIndex((block) => block.kind === 'heading' && block.level <= level)
  const section = stop === -1 ? after : after.slice(0, stop)
  const sources = section.flatMap((block) => (block.kind === 'list' ? toSources(block) : []))

  if (sources.length === 0) {
    return { blocks, sources: [] }
  }

  return {
    blocks: [
      ...blocks.slice(0, at),
      ...section.filter((block) => block.kind !== 'list'),
      ...after.slice(section.length),
    ],
    sources,
  }
}

function isSourcesHeading(block: Block): boolean {
  return block.kind === 'heading' && isSourcesTitle(toPlain(block.inline))
}

function toSources(list: ListBlock): readonly ReportSource[] {
  return list.items.map((item, index) => {
    const url = firstLink(item.inline)

    return {
      n: item.n ?? index + 1,
      text: toPlain(item.inline).trim(),
      ...(url === undefined ? {} : { url }),
    }
  })
}

function firstLink(inline: readonly Inline[]): string | undefined {
  for (const node of inline) {
    if (node.kind === 'link') {
      return node.href
    }

    if (node.kind === 'bold' || node.kind === 'italic') {
      const inner = firstLink(node.children)

      if (inner !== undefined) {
        return inner
      }
    }
  }

  return undefined
}
