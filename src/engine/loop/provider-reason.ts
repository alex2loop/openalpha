import type { RunResult } from '@/engine/types/run'
import { scrubCredentials } from '@/core/security/credentials'
import { toSingleLine, truncate } from '@/core/utils/text'

const PROVIDER_REASON_MAX_CHARS = 160
const REASON_FIELDS = ['error', 'message'] as const

/** The provider's own words for refusing a model call: the message its error body carries, as one
 *  line scrubbed of credentials and cut short. Absent unless the run halted on a model call. */
export function providerReasonOf(
  result: Pick<RunResult, 'haltCode' | 'errorMessage'>
): string | undefined {
  if (result.haltCode !== 'llm_error' || result.errorMessage === undefined) {
    return undefined
  }

  const body = result.errorMessage
  const message = messageOf(parseBody(body)) ?? body
  const reason = toSingleLine(scrubCredentials(message)).trim()

  return reason === '' ? undefined : truncate(reason, PROVIDER_REASON_MAX_CHARS)
}

// An error body is JSON in the shapes of a dozen vendors, or plain text: the first text under
// `error` (an object or a string) or `message` is the sentence the vendor wrote.
function messageOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return messageOf(value[0])
  }

  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  for (const field of REASON_FIELDS) {
    const found = messageOf(Reflect.get(value, field))

    if (found !== undefined) {
      return found
    }
  }

  return undefined
}

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    // A plain-text or HTML body is not an error: the caller reads it as it came.
    return undefined
  }
}
