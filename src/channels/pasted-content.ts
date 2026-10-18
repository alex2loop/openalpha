import { randomBytes } from 'node:crypto'

// The chat agent's prompt names this tag: forwarded text is data unless the operator's own words
// ask it to act, and an id it cannot guess stops that text from closing the tag itself.
const PASTED_CONTENT_TAG = 'pasted_content'
const PASTED_CONTENT_ID_BYTES = 4

export function toPastedContent(text: string): string {
  const id = randomBytes(PASTED_CONTENT_ID_BYTES).toString('hex')
  const open = `<${PASTED_CONTENT_TAG} id="${id}">`
  const close = `</${PASTED_CONTENT_TAG} id="${id}">`

  return `${open}\n${text}\n${close}`
}
