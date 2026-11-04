import type { Logger } from '@/core/logging/logger'
import type { LogEntry } from '@/core/types/log-entry'
import { scrubCredentials } from '@/core/security/credentials'

import { scrubLogFields } from './scrub'

/** A logger that hands each warn, error and fatal line to `report` and drops the rest. Every entry
 *  passes the scrub the daemon's logger applies, so no key reaches `report`. It keeps nothing: the
 *  owner of `report` decides where an entry lives and how many. */
export function createEntryLogger(report: (entry: LogEntry) => void): Logger {
  return bound(report, {})
}

function bound(report: (entry: LogEntry) => void, bindings: Record<string, unknown>): Logger {
  const entryAt =
    (level: LogEntry['level']): Logger['warn'] =>
    (msg, fields) => {
      try {
        report({
          time: Date.now(),
          level,
          key: scrubCredentials(msg),
          fields: scrubLogFields({ ...bindings, ...fields }),
        })
      } catch {
        // A logger never throws into the code it reports on.
      }
    }

  return {
    warn: entryAt('warn'),
    error: entryAt('error'),
    fatal: entryAt('fatal'),
    // biome-ignore lint/suspicious/noEmptyBlockStatements: info and debug are dropped
    info() {},
    // biome-ignore lint/suspicious/noEmptyBlockStatements: info and debug are dropped
    debug() {},
    child: (more) => bound(report, { ...bindings, ...scrubLogFields(more) }),
  }
}
