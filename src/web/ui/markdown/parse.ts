import { isSourcesTitle } from '@/web/text/sources-title'

// A longer report is cut, and a line or paragraph longer than `INLINE_MAX_CHARS` reads as plain text:
// the inline scan is quadratic in the worst case.
const REPORT_MAX_CHARS = 200_000
const INLINE_MAX_CHARS = 10_000
const HEADING_ID_PREFIX = 'rh'
const SOURCE_ID_PREFIX = 'rs'
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^\s*>\s?(.*)$/
// A bullet, a number, or a `[n]` footnote line.
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)]|\[\d{1,3}\])\s+(.*)$/
const TABLE_ROW = /^\s*\|/
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/
const NUMBER_MARKER = /\d+/
const BULLET_MARKER = /^[-*+]$/
const INDENTED = /^\s/
const LEADING_PIPE = /^\|/
const TRAILING_PIPE = /\|$/
const LINE_BREAK = /\r\n?/g
const BARE_URL_TAIL = /[.,;:!?)\]'"]+$/
const INLINE =
  /\*\*(?=\S)(.+?)(?<=\S)\*\*|\*(?=\S)(.+?)(?<=\S)\*|`([^`\n]+)`|\[(\d{1,3})\](?!\()|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>]+)/gu

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold' | 'italic'; readonly children: readonly Inline[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'note'; readonly n: number }
  | { readonly kind: 'link'; readonly href: string; readonly text: string }

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
  }
}

/** The element id of source `n`, which a `[n]` mark jumps to. */
export function sourceAnchor(n: number): string {
  return `${SOURCE_ID_PREFIX}${n}`
}

/** The inline marks of one run of text. */
function parseInline(source: string): readonly Inline[] {
  if (source.length > INLINE_MAX_CHARS) {
    return [{ kind: 'text', text: source }]
  }

  const nodes: Inline[] = []
  let cursor = 0

  for (const match of source.matchAll(INLINE)) {
    const found = toInline(match)

    if (found === undefined) {
      continue
    }

    pushText(nodes, source.slice(cursor, match.index))
    nodes.push(found.node)
    cursor = match.index + found.length
  }

  pushText(nodes, source.slice(cursor))

  return nodes
}

/** The words of a run, marks dropped. */
export function toPlain(inline: readonly Inline[]): string {
  return inline.map(nodePlain).join('')
}

function nodePlain(node: Inline): string {
  switch (node.kind) {
    case 'text':
    case 'code':
    case 'link':
      return node.text
    case 'note':
      return `[${node.n}]`
    case 'bold':
    case 'italic':
      return toPlain(node.children)
  }
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
  const heading = HEADING.exec(line)

  if (heading !== null) {
    const [, marks = '', text = ''] = heading

    return {
      block: { kind: 'heading', level: marks.length, id: '', inline: parseInline(text) },
      next: index + 1,
    }
  }

  if (RULE.test(line)) {
    return { block: { kind: 'rule' }, next: index + 1 }
  }

  if (TABLE_ROW.test(line) && TABLE_DIVIDER.test(lines[index + 1] ?? '')) {
    return takeTable(lines, index)
  }

  if (QUOTE.test(line)) {
    return takeQuote(lines, index)
  }

  return LIST_ITEM.test(line) ? takeList(lines, index) : takeParagraph(lines, index)
}

function startsBlock(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? ''

  return (
    line.trim() === '' ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    LIST_ITEM.test(line) ||
    (TABLE_ROW.test(line) && TABLE_DIVIDER.test(lines[index + 1] ?? ''))
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
  let match = QUOTE.exec(lines[end] ?? '')

  while (match !== null) {
    quoted.push(match[1] ?? '')
    end++
    match = QUOTE.exec(lines[end] ?? '')
  }

  return { block: { kind: 'quote', inline: parseInline(joinLines(quoted, '\n')) }, next: end }
}

function takeTable(lines: readonly string[], index: number): Taken {
  const rows: (readonly (readonly Inline[])[])[] = []
  let end = index + 2

  while (end < lines.length && TABLE_ROW.test(lines[end] ?? '')) {
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
  return LIST_ITEM.test(line) || (line.trim() !== '' && INDENTED.test(line))
}

function buildList(lines: readonly string[]): ListBlock {
  const first = LIST_ITEM.exec(lines[0] ?? '')
  const baseIndent = first?.[1]?.length ?? 0
  const groups: string[][] = []

  for (const line of lines) {
    const item = LIST_ITEM.exec(line)

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
  const match = LIST_ITEM.exec(head)
  const marker = match?.[2] ?? ''
  const nestedAt = rest.findIndex((line) => LIST_ITEM.test(line))
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

function toInline(match: RegExpMatchArray): { node: Inline; length: number } | undefined {
  const [whole, bold, italic, code, note, label, target, bare] = match

  if (bold !== undefined) {
    return { node: { kind: 'bold', children: parseInline(bold) }, length: whole.length }
  }

  if (italic !== undefined) {
    return { node: { kind: 'italic', children: parseInline(italic) }, length: whole.length }
  }

  if (code !== undefined) {
    return { node: { kind: 'code', text: code }, length: whole.length }
  }

  if (note !== undefined) {
    return { node: { kind: 'note', n: Number.parseInt(note, 10) }, length: whole.length }
  }

  if (label !== undefined && target !== undefined) {
    const href = toSafeHref(target)

    return href === undefined
      ? undefined
      : { node: { kind: 'link', href, text: label }, length: whole.length }
  }

  return bare === undefined ? undefined : toBareLink(bare)
}

// A web address in prose keeps the punctuation that closes its sentence outside the link.
function toBareLink(address: string): { node: Inline; length: number } | undefined {
  const trimmed = address.replace(BARE_URL_TAIL, '')
  const href = toSafeHref(trimmed)

  return href === undefined
    ? undefined
    : { node: { kind: 'link', href, text: trimmed }, length: trimmed.length }
}

function toSafeHref(address: string): string | undefined {
  try {
    const url = new URL(address)

    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    // Not an address at all: it stays text.
    return undefined
  }
}

function pushText(nodes: Inline[], text: string): void {
  if (text !== '') {
    nodes.push({ kind: 'text', text })
  }
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
