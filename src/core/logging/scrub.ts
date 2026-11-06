import { formatErrForLog, isSensitiveKey, scrubCredentials } from '@/core/security/credentials'

const LOG_SCRUB_MAX_DEPTH = 8

/** Fields as a log line may carry them: every string scrubbed of credentials, every Error turned
 *  into its `formatErrForLog` payload, sensitive keys redacted, depth bounded. */
export function scrubLogFields(fields?: Record<string, unknown>): Record<string, unknown> {
  if (fields === undefined) {
    return {}
  }

  const scrubbed = scrubLogValue(fields, new WeakSet(), 0)
  return isLogRecord(scrubbed) ? scrubbed : {}
}

function scrubLogValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'string') {
    return scrubCredentials(value)
  }

  if (value instanceof Error) {
    return scrubLogValue(formatErrForLog(value), seen, depth)
  }

  if (depth >= LOG_SCRUB_MAX_DEPTH) {
    return '[Truncated]'
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  if (seen.has(value)) {
    return '[Circular]'
  }

  if (!(Array.isArray(value) || isLogRecord(value))) {
    return '[Unsupported]'
  }

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => scrubLogValue(item, seen, depth + 1))
    }

    const entries: [string, unknown][] = []
    for (const [key, item] of Object.entries(value)) {
      entries.push([key, isSensitiveKey(key) ? '[REDACTED]' : scrubLogValue(item, seen, depth + 1)])
    }

    return Object.fromEntries(entries)
  } finally {
    seen.delete(value)
  }
}

function isLogRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
