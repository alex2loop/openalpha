import type {
  FocusCall,
  FocusCallRow,
} from '@/trading/features/suggestion/store/suggestion-outcome'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import {
  FOCUS_CALL_COLUMNS,
  LATEST_OF_SAME_CALL_SQL,
  SCORED_SQL,
  toFocusCall,
} from '@/trading/features/suggestion/store/suggestion-outcome'

const MODEL_SEPARATOR = ','

/** A scored call and the one model that argued it. */
export interface ModelCall extends FocusCall {
  readonly model: string
}

interface ModelCallRow extends FocusCallRow {
  readonly debate_models: string
}

/** The sorted model list as `suggestions.debate_models` keeps it; null where no model argued. */
export function toDebateModelsColumn(models: readonly string[]): string | null {
  return models.length === 0 ? null : [...models].sort().join(MODEL_SEPARATOR)
}

interface ModelCallOptions {
  /** Only these focuses' rows, the focuses the track record beside it reads. */
  readonly focusKeys: readonly FocusKey[]
  readonly signal: AbortSignal
}

/** The scored calls of the given focuses whose debate ran on exactly one model, pooled across
 *  versions like `listFocusCalls`. A row with no stored chain (written before it was kept) or with
 *  several models is left out: neither can be credited to one model. The caller folds repeats per
 *  model with `independentCalls`. */
export async function listScoredByModel(
  deps: StoreDeps,
  options: ModelCallOptions
): Promise<readonly ModelCall[]> {
  assertNotAborted(options.signal)

  const { dialect } = deps
  const rows = await deps.db.query<ModelCallRow>(
    `SELECT ${FOCUS_CALL_COLUMNS}, debate_models FROM suggestions WHERE ${SCORED_SQL} ` +
      `AND exit_day IS NOT NULL AND debate_models IS NOT NULL ` +
      `AND debate_models NOT LIKE ${dialect.param(1)} ` +
      `AND focus_key IN (${dialect.paramList(options.focusKeys.length, 2)}) ` +
      `AND ${LATEST_OF_SAME_CALL_SQL}`,
    [`%${MODEL_SEPARATOR}%`, ...options.focusKeys]
  )

  return rows.map((row) => ({ ...toFocusCall(row), model: row.debate_models }))
}
