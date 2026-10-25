// Every scan is bounded so no input can freeze the page: a run longer than `INLINE_MAX_CHARS` reads as
// plain text (the inline scan is quadratic in the worst case).
const INLINE_MAX_CHARS = 10_000
const ADDRESS_CLOSERS = '.,;:!?)]\'"'
const INLINE =
  /\*\*(?=\S)(.+?)(?<=\S)\*\*|\*(?=\S)(.+?)(?<=\S)\*|`([^`\n]+)`|\[(\d{1,3})\](?!\()|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>]+)/gu

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bold' | 'italic'; readonly children: readonly Inline[] }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'note'; readonly n: number }
  | { readonly kind: 'link'; readonly href: string; readonly text: string }

/** The inline marks of one run of text. */
export function parseInline(source: string): readonly Inline[] {
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
  const trimmed = trimAddressTail(address)
  const href = toSafeHref(trimmed)

  return href === undefined
    ? undefined
    : { node: { kind: 'link', href, text: trimmed }, length: trimmed.length }
}

function trimAddressTail(address: string): string {
  let end = address.length

  while (end > 0 && ADDRESS_CLOSERS.includes(address[end - 1] ?? '')) {
    end--
  }

  return address.slice(0, end)
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
