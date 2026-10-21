// MarkdownV2 reserved characters per the Telegram Bot API style guide.
const MDV2_ESCAPE_RE = /[_*[\]()~`>#+\-=|{}.!\\]/g
const FENCE_ESCAPE_RE = /[`\\]/g
/** All Telegram parses inside a link target, so the rest of the URL travels as it was written. */
const URL_ESCAPE_RE = /[)\\]/g
const FENCE_RE = /```[\s\S]*?```/g
const QUOTE_RUN_RE = /(?:^>[^\n]*(?:\n|$))+/gm
const QUOTE_MARKER_RE = /^>[ \t]?/
const INLINE_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|`([^`\n]+)`/g
const FENCE_DELIMITER_LENGTH = 3
const BACKSLASH_ESCAPE_RE = /\\([\s\S])/g
const LEADING_NEWLINE_RE = /^\n/
// Every entity this module writes, plus a backslash escape: a fence, inline code, a link, the
// expandable-quote opener `**>` and closer `||`, a quote line's `>`, and bold's `*`. A literal
// `*`, `|`, `>`, `[` or `` ` `` is always escaped, so only a marker reaches these arms bare.
const PLAIN_TOKEN_RE =
  /```([\s\S]*?)```|`((?:[^`\\]|\\[\s\S])*)`|\[((?:[^\]\\]|\\[\s\S])*)\]\(((?:[^)\\]|\\[\s\S])*)\)|\*\*>|\|\||^>|\*|\\[\s\S]/gm
/** What opens and closes an expandable blockquote on the wire. Exported because the chunker has to
 *  re-open and re-close a run its boundary split, and two spellings of the same marker would fold
 *  on one path and not the other. */
export const EXPANDABLE_OPEN = '**>'
export const EXPANDABLE_CLOSE = '||'

/** One pass over a source: what to do with each match of `pattern`, and what to do with the text
 *  between the matches. Nesting three of these is what keeps one place deciding what is markup. */
interface OutsideReplacement {
  readonly pattern: RegExp
  readonly onMatch: (match: RegExpMatchArray) => string
  readonly onGap: (gap: string) => string
}

/** Markdown as the trading surface writes it, in the dialect Telegram parses: a fence stays
 *  verbatim, a `>` run becomes one expandable blockquote, and everything else is bold, a link,
 *  inline code, or escaped text. Every arm closes what it opens, so the message can always be
 *  parsed. */
export function toMarkdownV2(text: string): string {
  return replaceOutside(text, {
    pattern: FENCE_RE,
    onMatch: (match) => toFence(match[0]),
    onGap: toQuoted,
  })
}

/** What a message resent without `parse_mode` should read as: the agent's text with every marker
 *  and escape this module added taken back out. */
export function toPlainText(markdownV2: string): string {
  return replaceOutside(markdownV2, {
    pattern: PLAIN_TOKEN_RE,
    onMatch: toPlainToken,
    onGap: (gap) => gap,
  })
}

function toPlainToken(match: RegExpMatchArray): string {
  const [token, fence, code, label, url] = match

  if (fence !== undefined) {
    return unescapeBackslashes(fence).replace(LEADING_NEWLINE_RE, '')
  }

  if (code !== undefined) {
    return unescapeBackslashes(code)
  }

  if (label !== undefined) {
    return `${unescapeBackslashes(label)} (${unescapeBackslashes(url ?? '')})`
  }

  return token?.startsWith('\\') ? unescapeBackslashes(token) : ''
}

function unescapeBackslashes(text: string): string {
  return text.replace(BACKSLASH_ESCAPE_RE, '$1')
}

function replaceOutside(source: string, replacement: OutsideReplacement): string {
  let out = ''
  let last = 0

  for (const match of source.matchAll(replacement.pattern)) {
    const start = match.index ?? 0

    out += replacement.onGap(source.slice(last, start)) + replacement.onMatch(match)
    last = start + match[0].length
  }

  return out + replacement.onGap(source.slice(last))
}

function toQuoted(text: string): string {
  return replaceOutside(text, {
    pattern: QUOTE_RUN_RE,
    onMatch: (match) => toBlockquote(match[0]),
    onGap: toInline,
  })
}

function toInline(text: string): string {
  return replaceOutside(text, {
    pattern: INLINE_RE,
    onMatch: toInlineMarkup,
    onGap: escapeText,
  })
}

/** A run of `>` lines becomes one expandable blockquote: the reader taps it open. */
function toBlockquote(run: string): string {
  const trailing = run.endsWith('\n') ? '\n' : ''
  const lines = run
    .trimEnd()
    .split('\n')
    .map((line) => toInline(line.replace(QUOTE_MARKER_RE, '')))

  return `${EXPANDABLE_OPEN}${lines.join('\n>')}${EXPANDABLE_CLOSE}${trailing}`
}

/** No italic arm: `_` is a MarkdownV2 special the surface writes far more often as a word separator
 *  than as emphasis, and a stray one breaks the whole message. */
function toInlineMarkup(match: RegExpMatchArray): string {
  const [, linkText, url, bold, code] = match

  if (bold !== undefined) {
    return `*${escapeText(bold)}*`
  }

  if (code !== undefined) {
    return `\`${code.replace(FENCE_ESCAPE_RE, '\\$&')}\``
  }

  return `[${escapeText(linkText ?? '')}](${(url ?? '').replace(URL_ESCAPE_RE, '\\$&')})`
}

function toFence(block: string): string {
  const inner = block.slice(FENCE_DELIMITER_LENGTH, -FENCE_DELIMITER_LENGTH)

  return `\`\`\`${inner.replace(FENCE_ESCAPE_RE, '\\$&')}\`\`\``
}

function escapeText(text: string): string {
  return text.replace(MDV2_ESCAPE_RE, '\\$&')
}
