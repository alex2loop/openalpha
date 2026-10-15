import { scrubCredentials } from '@/core/security/credentials'

// An OSC payload ends at its terminator or the next ESC and is bounded to 4096 characters, so a
// page of bare `ESC ]` stays linear.
// biome-ignore format: keep regex on one line so the lint suppression below covers it
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences require ESC and CSI control chars
const ANSI_ESCAPE_RE = /[\x1b\x9b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><]|\x1b\][^\x07\x1b]{0,4096}(?:\x07|\x1b\\)/g
const ELLIPSIS = '...'
const MIN_RUN = 2
const MIDDLE_ELISION = '\n\n[...]\n\n'
const MIDDLE_ELISION_BYTES = Buffer.byteLength(MIDDLE_ELISION, 'utf8')
const TAIL_BUDGET_DIVISOR = 5
const UTF8_CONT_MASK = 0xc0
const UTF8_CONT_BYTE = 0x80
const QUERY_TERM_RE = /[\p{L}\p{N}]{3,}/gu
const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const TRAILING_WS_RE = /[ \t\r]+$/
const EDGE_BLANKS_RE = /^\n+|\n+$/g
// Drops C0/C1 control characters (Unicode category Cc) and format controls (category Cf)
// except newline and tab, which legitimate output may contain.
const SURFACE_CONTROL_RE = /[\p{Cc}\p{Cf}]/gu
const SLASH_COMMAND_NAME_RE = /^[a-z][a-z0-9]*$/
const COMBINING_MARK_RE = /[\u0300-\u036f]/g
const FENCE = '```'
const FENCE_RUN_RE = /`{3,}/g
// Every class below leaves out the character that would start the next candidate (`<` or `[`), so
// a scan from each start stops at the next one and a page of bare `<` or `[` stays linear.
const ACTIVE_TAGS = ['script', 'style', 'iframe', 'object', 'embed'] as const
const ACTIVE_OPEN_RE = new RegExp(`<(${ACTIVE_TAGS.join('|')})\\b[^<>]*>`, 'gi')
// Global so `lastIndex` can start the search past the open tag; it is set before every use.
const ACTIVE_CLOSE_RES: ReadonlyMap<string, RegExp> = new Map(
  ACTIVE_TAGS.map((name) => [name, new RegExp(`</${name}>`, 'gi')])
)
const HTML_TAG_RE = /<[^<>]+>/g
const MARKDOWN_LINK_RE = /!?\[([^[\]]*)\]\([^[)]*\)/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '')
}

export function stripControls(text: string): string {
  return text.replace(SURFACE_CONTROL_RE, (ch) => (ch === '\n' || ch === '\t' ? ch : ''))
}

/** Plain text from a fetched page: script-like blocks with their content, links reduced to their
 *  label, and tags removed. Linear on hostile input. */
export function stripMarkup(text: string): string {
  return stripActiveBlocks(text).replace(MARKDOWN_LINK_RE, '$1').replace(HTML_TAG_RE, '')
}

// An element with no closing tag is not a block, and neither is any later element of its name, so
// each name is searched for its close at most once past the end of the text.
function stripActiveBlocks(text: string): string {
  const unclosed = new Set<string>()
  let out = ''
  let cursor = 0

  for (const open of text.matchAll(ACTIVE_OPEN_RE)) {
    const name = (open[1] ?? '').toLowerCase()
    const from = open.index + open[0].length

    if (open.index < cursor || unclosed.has(name)) {
      continue
    }

    const close = ACTIVE_CLOSE_RES.get(name)

    if (close === undefined) {
      continue
    }

    close.lastIndex = from

    const end = close.exec(text)

    if (end === null) {
      unclosed.add(name)
      continue
    }

    out += text.slice(cursor, open.index)
    cursor = end.index + end[0].length
  }

  return out + text.slice(cursor)
}

/** Hygiene for text a surface renders verbatim from an untrusted source. Newlines survive. */
export function sanitizeDisplayText(text: string): string {
  return scrubCredentials(stripControls(stripAnsi(text)))
}

/** Outside text as a code block a chat shows verbatim, so a link or markup in it is not live. A run
 *  of backticks inside would close the block early, so it is shown as quotes. */
export function toFencedText(text: string): string {
  return `${FENCE}\n${text.replace(FENCE_RUN_RE, (run) => "'".repeat(run.length))}\n${FENCE}`
}

export function isSlashCommandName(name: string): boolean {
  return SLASH_COMMAND_NAME_RE.test(name)
}

export function truncate(s: string, max: number): string {
  if (max <= 0) {
    return ''
  }

  if (s.length <= max) {
    return s
  }

  if (max < ELLIPSIS.length) {
    return s.slice(0, max)
  }

  return `${s.slice(0, max - ELLIPSIS.length)}${ELLIPSIS}`
}

// Relevance-scoring terms for excerpt selection. Latin scripts tokenize on word runs; Han/kana
// text has no word separators, so CJK runs also decompose into bigrams — otherwise a whole CJK
// question is one term that never substring-matches any paragraph.
export function extractQueryTerms(query: string): ReadonlySet<string> {
  const terms = new Set(query.toLocaleLowerCase().match(QUERY_TERM_RE) ?? [])

  for (const term of [...terms]) {
    if (!CJK_CHAR_RE.test(term)) {
      continue
    }

    let previous = ''
    for (const character of term) {
      if (previous !== '') {
        terms.add(previous + character)
      }
      previous = character
    }
  }

  return terms
}

export function scoreParagraph(paragraph: string, terms: ReadonlySet<string>): number {
  const lower = paragraph.toLocaleLowerCase()
  let score = 0

  for (const term of terms) {
    if (lower.includes(term)) {
      score += 1
    }
  }

  return score
}

// Head+tail byte truncation: conclusions and data tables tend to sit at the end of long
// documents, so a head-only cut loses exactly the part research sources are fetched for.
/** Whether `truncateUtf8HeadTail` dropped a middle span from this text. */
export function hasElidedMiddle(text: string): boolean {
  return text.includes(MIDDLE_ELISION)
}

export function truncateUtf8HeadTail(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf8')

  if (buf.byteLength <= maxBytes) {
    return text
  }

  if (maxBytes <= MIDDLE_ELISION_BYTES) {
    return utf8Window(buf, 0, maxBytes)
  }

  const tailBytes = Math.floor((maxBytes - MIDDLE_ELISION_BYTES) / TAIL_BUDGET_DIVISOR)
  const headBytes = maxBytes - MIDDLE_ELISION_BYTES - tailBytes
  const head = utf8Window(buf, 0, headBytes)
  const tail = utf8Window(buf, buf.byteLength - tailBytes, buf.byteLength)

  return `${head}${MIDDLE_ELISION}${tail}`
}

// Byte window over one encode of the whole string, with both edges pulled inward to a character
// boundary so a multi-byte character is never split into replacement characters. Shrinking rather
// than growing keeps the window within budget.
function utf8Window(buf: Buffer, start: number, end: number): string {
  return buf.subarray(alignForward(buf, start), alignBack(buf, end)).toString('utf8')
}

function alignBack(buf: Buffer, offset: number): number {
  let i = clampOffset(buf, offset)
  while (i > 0 && i < buf.byteLength && isContinuationByte(buf[i])) {
    i -= 1
  }
  return i
}

function alignForward(buf: Buffer, offset: number): number {
  let i = clampOffset(buf, offset)
  while (i < buf.byteLength && isContinuationByte(buf[i])) {
    i += 1
  }
  return i
}

function clampOffset(buf: Buffer, offset: number): number {
  return Math.max(0, Math.min(offset, buf.byteLength))
}

export function isContinuationByte(byte: number | undefined): boolean {
  return byte !== undefined && (byte & UTF8_CONT_MASK) === UTF8_CONT_BYTE
}

// Deterministic, lossless-ish normalization for bloated tool output: strips trailing
// whitespace, collapses runs of blank lines to one, and collapses runs of identical
// consecutive lines to one line + a count marker. Runs before the byte cap in the
// tool executor so the cap retains more signal. No LLM, no config — always on.
export function reduceOutput(s: string): string {
  const lines = s.split('\n').map((line) => line.replace(TRAILING_WS_RE, ''))
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i] ?? ''

    if (line === '') {
      out.push('')
      while (i < lines.length && (lines[i] ?? '') === '') {
        i++
      }
      continue
    }

    let run = 1
    while (i + run < lines.length && lines[i + run] === line) {
      run++
    }

    out.push(line)
    if (run >= MIN_RUN) {
      out.push(`[+${run - 1} identical lines]`)
    }
    i += run
  }

  return out.join('\n').replace(EDGE_BLANKS_RE, '')
}

// Iterative Levenshtein over two rows; bounded by the shorter argument length, so a
// typo against a short command name never allocates a full matrix.
export function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0
  }

  if (a.length === 0) {
    return b.length
  }

  if (b.length === 0) {
    return a.length
  }

  const init: number[] = []
  for (let i = 0; i <= b.length; i++) {
    init.push(i)
  }
  let prev: number[] = init
  let curr: number[] = new Array<number>(b.length + 1).fill(0)

  // Rows are fully populated for indices 0..b.length. The `?? 0` guards only satisfy
  // noUncheckedIndexedAccess; the indices are always in range by construction.
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      const del = (prev[j] ?? 0) + 1
      const ins = (curr[j - 1] ?? 0) + 1
      const sub = (prev[j - 1] ?? 0) + cost
      curr[j] = Math.min(del, ins, sub)
    }
    const swap = prev
    prev = curr
    curr = swap
  }

  return prev[b.length] ?? 0
}

// Every C0/C1 control becomes a space, newline included, so the result is safe to drop into a
// one-line label. `stripControls` above deletes them instead and keeps newlines — different act.
export function toSingleLine(value: string): string {
  let result = ''

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    result += code <= 0x1f || (code >= 0x7f && code <= 0x9f) ? ' ' : char
  }

  return result
}

/** Lower case without diacritics, `đ` as `d`: how a person types a Vietnamese name they mean to
 *  find. Databases fold ASCII case only, so a match that must ignore marks is folded here. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARK_RE, '').replace(/đ/gi, 'd').toLowerCase()
}
