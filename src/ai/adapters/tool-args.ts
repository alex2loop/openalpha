import type { Logger } from '@/core/logging/logger'
import { formatErrForLog, scrubCredentials } from '@/core/security/credentials'

const TOOL_ARGS_PREVIEW_CHARS = 80
const TRAILING_COMMA_RE = /,\s*([}\]])$/

// A streamed tool call ends with incomplete JSON when the model hits its token limit: close what
// it left open. Undefined when the cut fell inside a string or the delimiters never matched.
function repairJson(raw: string): unknown | undefined {
  const trimmed = raw.trim().replace(TRAILING_COMMA_RE, '$1')
  const closers = closingDelimiters(trimmed)

  if (closers === undefined) {
    return undefined
  }

  try {
    return JSON.parse(trimmed + closers.reverse().join(''))
  } catch {
    return undefined
  }
}

function closingDelimiters(raw: string): string[] | undefined {
  const state: JsonScanState = { closers: [], inString: false, escaped: false }

  for (const char of raw) {
    if (!advanceJsonScan(state, char)) {
      return undefined
    }
  }

  return state.inString ? undefined : state.closers
}

interface JsonScanState {
  readonly closers: string[]
  inString: boolean
  escaped: boolean
}

function advanceJsonScan(state: JsonScanState, char: string): boolean {
  if (state.escaped) {
    state.escaped = false
    return true
  }

  if (char === '\\' && state.inString) {
    state.escaped = true
    return true
  }

  if (char === '"') {
    state.inString = !state.inString
    return true
  }

  if (state.inString) {
    return true
  }

  if (char === '{') {
    state.closers.push('}')
    return true
  }

  if (char === '[') {
    state.closers.push(']')
    return true
  }

  if (char !== '}' && char !== ']') {
    return true
  }

  return state.closers.pop() === char
}

// Truncated JSON is repaired when it can be; otherwise the raw string is handed back to the model
// as `{ raw }` so it sees its own malformed output and can self-correct on the next turn. Never
// throws.
export function parseToolArgs(raw: string, logger: Logger, adapter: string): unknown {
  if (raw.length === 0) {
    return {}
  }

  try {
    return JSON.parse(raw)
  } catch (err: unknown) {
    const repaired = repairJson(raw)

    if (repaired !== undefined) {
      return repaired
    }

    logger.warn('adapter.tool_args_parse_failed', {
      adapter,
      err: formatErrForLog(err),
      preview: scrubCredentials(raw.slice(0, TOOL_ARGS_PREVIEW_CHARS)),
    })

    return { raw }
  }
}
