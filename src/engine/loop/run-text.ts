import { scrubCredentials } from '@/core/security/credentials'
import {
  CHILD_SUMMARY_MAX_CHARS,
  RESEARCH_DEPTH_PREFIX,
  RUN_TITLE_MAX_CHARS,
} from '@/engine/constants'

const RESEARCH_DEPTH_RE = new RegExp(`^${RESEARCH_DEPTH_PREFIX}\\w+\\s+`)

// The depth prefix is the command's note to the researcher, not what the operator asked.
export function toRunTitle(text: string): string | undefined {
  return toScrubbedHead(text.replace(RESEARCH_DEPTH_RE, ''), RUN_TITLE_MAX_CHARS)
}

export function toChildSummary(text: string): string | undefined {
  return toScrubbedHead(text, CHILD_SUMMARY_MAX_CHARS)
}

// Scrubbed before the cut: a credential sliced in half would no longer match its pattern.
function toScrubbedHead(text: string, maxChars: number): string | undefined {
  const head = scrubCredentials(text).trim().slice(0, maxChars).trim()

  return head === '' ? undefined : head
}
