import { scrubCredentials } from '@/core/security/credentials'
import { CHILD_SUMMARY_MAX_CHARS, RUN_TITLE_MAX_CHARS } from '@/engine/constants'

export function toRunTitle(text: string): string | undefined {
  return toScrubbedHead(text, RUN_TITLE_MAX_CHARS)
}

export function toChildSummary(text: string): string | undefined {
  return toScrubbedHead(text, CHILD_SUMMARY_MAX_CHARS)
}

// Scrubbed before the cut: a credential sliced in half would no longer match its pattern.
function toScrubbedHead(text: string, maxChars: number): string | undefined {
  const head = scrubCredentials(text).trim().slice(0, maxChars).trim()

  return head === '' ? undefined : head
}
