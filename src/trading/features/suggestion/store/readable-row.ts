import type { Logger } from '@/core/logging/logger'
import type { Dialect } from '@/core/types/storage'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { StorageError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

export interface SuggestionStoreDeps extends StoreDeps {
  readonly logger: Logger
}

/** An unreadable row leaves the read rather than failing it, so one bad row cannot take every
 *  caller of the list down with it. Only a storage failure is dropped, and it is named: anything
 *  else is a defect here and belongs on the stack. */
export function readableRow<R extends { readonly id: string }, T>(
  row: R,
  toValue: (row: R) => T,
  logger: Logger
): readonly T[] {
  try {
    return [toValue(row)]
  } catch (err: unknown) {
    if (err instanceof StorageError) {
      logger.warn('trading.suggestion_row_unreadable', { id: row.id, err: formatErrForLog(err) })

      return []
    }

    throw err
  }
}

/** One top-level payload field as text, extracted in SQL; shared with the factor log, whose rows
 *  keep their payload the same way. */
export function buildPayloadFieldSql(dialect: Dialect, path: string): string {
  return dialect.name === 'postgres'
    ? `payload::jsonb ->> '${path}'`
    : `json_extract(payload, '$.${path}')`
}
