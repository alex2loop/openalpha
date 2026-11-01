// A sentence ends at a stop followed by a space or the end.
const SENTENCE_END_RE = /[.!?](?=\s|$)/u

/** The first sentence of `text`, trimmed; all of it when it has no stop. */
export function firstSentence(text: string): string {
  const trimmed = text.trim()
  const end = SENTENCE_END_RE.exec(trimmed)

  return end === null ? trimmed : trimmed.slice(0, end.index + 1)
}
