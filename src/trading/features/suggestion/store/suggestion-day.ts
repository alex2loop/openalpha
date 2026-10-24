import type { EpochRange } from '@/core/utils/time'
import type {
  FocusCall,
  FocusCallRow,
} from '@/trading/features/suggestion/store/suggestion-outcome'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import {
  FOCUS_CALL_COLUMNS,
  LATEST_OF_SAME_CALL_SQL,
  SCORED_SQL,
  toFocusCall,
} from '@/trading/features/suggestion/store/suggestion-outcome'

/** What one operator day added to the suggestion table. */
export interface SuggestionDayRead {
  /** Calls an analyst made that day; a recorded plan or a failed run is no call. */
  readonly callCount: number
  /** The scored calls that closed that day with the largest move, in either direction. */
  readonly closed: readonly FocusCall[]
}

export interface SuggestionDayOptions {
  readonly range: EpochRange
  /** How many closed calls to return. */
  readonly limit: number
  readonly signal: AbortSignal
}

export async function readSuggestionDay(
  deps: StoreDeps,
  options: SuggestionDayOptions
): Promise<SuggestionDayRead> {
  assertNotAborted(options.signal)

  const { fromMs, toMs } = options.range
  const p = deps.dialect.param
  const [counted, closed] = await Promise.all([
    deps.db.query<{ readonly count: number }>(
      `SELECT COUNT(*) AS count FROM suggestions WHERE is_call = 1 ` +
        `AND created_at >= ${p(1)} AND created_at < ${p(2)}`,
      [fromMs, toMs]
    ),
    deps.db.query<FocusCallRow>(
      `SELECT ${FOCUS_CALL_COLUMNS} FROM suggestions WHERE ${SCORED_SQL} ` +
        `AND exit_day IS NOT NULL AND resolved_at >= ${p(1)} AND resolved_at < ${p(2)} ` +
        `AND ${LATEST_OF_SAME_CALL_SQL} ORDER BY ABS(return_pct) DESC, id DESC LIMIT ${p(3)}`,
      [fromMs, toMs, options.limit]
    ),
  ])

  return {
    callCount: counted[0]?.count ?? 0,
    closed: closed.map(toFocusCall),
  }
}
