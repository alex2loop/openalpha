import type { Logger } from '@/core/logging/logger'
import { formatErrForLog, isSensitiveKey, scrubCredentials } from '@/core/security/credentials'

const MAX_DEPTH = 6
const MASK = '***'

type Level = 'warn' | 'error' | 'fatal'

interface LogRecord {
  readonly level: Level
  readonly at: number
  readonly msg: string
  readonly fields: Readonly<Record<string, unknown>>
}

export interface BrowserLogger extends Logger {
  /** The newest warnings and errors, oldest first. */
  recent(): readonly LogRecord[]
}

/** A worker has no file to write: it keeps the last `limit` warnings and errors in memory, scrubbed
 *  when they are written, so a page can show what went wrong and nothing a key could ride in. */
export function createBrowserLogger(limit: number): BrowserLogger {
  const ring: LogRecord[] = []
  const root = writeTo(ring, limit, {})

  return { ...root, recent: () => [...ring] }
}

function writeTo(ring: LogRecord[], limit: number, bindings: Record<string, unknown>): Logger {
  const keep = (level: Level, msg: string, fields?: Record<string, unknown>): void => {
    ring.push({
      level,
      at: Date.now(),
      msg: scrubCredentials(msg),
      fields: scrubFields({ ...bindings, ...fields }, 0),
    })

    if (ring.length > limit) {
      ring.splice(0, ring.length - limit)
    }
  }

  return {
    warn: (msg, fields) => keep('warn', msg, fields),
    error: (msg, fields) => keep('error', msg, fields),
    fatal: (msg, fields) => keep('fatal', msg, fields),
    // Below a warning nothing is kept: the ring is for what a visitor may need to report.
    info: () => undefined,
    debug: () => undefined,
    child: (extra) => writeTo(ring, limit, { ...bindings, ...extra }),
  }
}

function scrubFields(
  fields: Record<string, unknown>,
  depth: number
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      isSensitiveKey(key) ? MASK : scrubValue(value, depth),
    ])
  )
}

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') {
    return scrubCredentials(value)
  }

  if (value instanceof Error) {
    return formatErrForLog(value)
  }

  if (Array.isArray(value)) {
    return depth >= MAX_DEPTH ? MASK : value.map((item) => scrubValue(item, depth + 1))
  }

  if (typeof value === 'object' && value !== null) {
    return depth >= MAX_DEPTH
      ? MASK
      : scrubFields(Object.fromEntries(Object.entries(value)), depth + 1)
  }

  return value
}
