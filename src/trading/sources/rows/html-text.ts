const NUMERIC_ENTITY_RE = /&#(x)?([0-9a-fA-F]+);/g
const NON_TEXT_BLOCK_RE = /<(script|style|noscript)\b[\s\S]*?<\/\1>/gi
const TAG_RE = /<[^>]+>/g
const WHITESPACE_RE = /\s+/g
const UNICODE_MAX = 0x10_ffff
const SURROGATE_MIN = 0xd800
const SURROGATE_MAX = 0xdfff

/** Surrogates excluded with out-of-range values: a lone one reaches a provider that rejects it. */
function isEncodableCodePoint(code: number): boolean {
  return (
    Number.isInteger(code) &&
    code > 0 &&
    code <= UNICODE_MAX &&
    !(code >= SURROGATE_MIN && code <= SURROGATE_MAX)
  )
}

/** A headline reaches evidence and then a prompt verbatim, so an undecoded `&amp;` is what the
 *  model reads. `&amp;` resolves last, so `&amp;lt;` yields the literal `&lt;` rather than `<`. */
export function decodeEntities(raw: string): string {
  return raw
    .replace(NUMERIC_ENTITY_RE, (whole, hex: string | undefined, digits: string) => {
      const code = Number.parseInt(digits, hex === undefined ? 10 : 16)

      return isEncodableCodePoint(code) ? String.fromCodePoint(code) : whole
    })
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

/** Tags become spaces, so a table cell never runs into the next one. */
export function htmlToText(raw: string): string {
  return decodeEntities(raw.replace(NON_TEXT_BLOCK_RE, ' ').replace(TAG_RE, ' '))
    .replace(WHITESPACE_RE, ' ')
    .trim()
}
