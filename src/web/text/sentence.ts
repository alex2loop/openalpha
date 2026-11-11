import { locale } from '@/web/state/session'

// A sentence ends at a stop followed by a space or the end.
const SENTENCE_END_RE = /[.!?](?=\s|$)/u

/** The first sentence of `text`, trimmed; all of it when it has no stop. */
export function firstSentence(text: string): string {
  const trimmed = text.trim()
  const end = SENTENCE_END_RE.exec(trimmed)

  return end === null ? trimmed : trimmed.slice(0, end.index + 1)
}

/** `text` with its first letter in capitals for the page's language: the daemon writes names in
 *  lower case, for use mid-line. */
export function toSentenceStart(text: string): string {
  return `${text.charAt(0).toLocaleUpperCase(locale.value)}${text.slice(1)}`
}
