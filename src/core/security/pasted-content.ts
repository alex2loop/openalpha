import { randomBytes } from 'node:crypto'

// The chat agent's prompt names this tag: forwarded text is data unless the operator's own words
// ask it to act, and an id it cannot guess stops that text from closing the tag itself.
const PASTED_CONTENT_TAG = 'pasted_content'
const PASTED_CONTENT_ID_BYTES = 4
const PASTED_CONTENT_RE = new RegExp(
  `<${PASTED_CONTENT_TAG} id="([0-9a-f]+)">[\\s\\S]*?</${PASTED_CONTENT_TAG} id="\\1">`,
  'g'
)

export function toPastedContent(text: string): string {
  const id = randomBytes(PASTED_CONTENT_ID_BYTES).toString('hex')
  const open = `<${PASTED_CONTENT_TAG} id="${id}">`
  const close = `</${PASTED_CONTENT_TAG} id="${id}">`

  return `${open}\n${text}\n${close}`
}

/** The operator's own words: what they forwarded is someone else's text. */
export function withoutPastedContent(text: string): string {
  return text.replace(PASTED_CONTENT_RE, '')
}
