import type { ModelCall } from '@/trading/features/suggestion/store/suggestion-model'
import {
  independentCalls,
  isWinningReturn,
  MINIMUM_TRACK_RECORD_SAMPLE,
} from '@/trading/features/suggestion/pipeline/reporting'

/** One model and how the calls it argued alone resolved. A call argued by several models counts for
 *  none of them, so a win rate here is never shared credit. */
export interface ModelRecord {
  readonly model: string
  readonly resolvedCount: number
  readonly winCount: number
  /** Absent below `MINIMUM_TRACK_RECORD_SAMPLE`, like every record's rate. */
  readonly winRate?: number
}

/** Repeats are folded per model with `independentCalls`, as every track-record rate folds them. */
export function buildModelRecords(calls: readonly ModelCall[]): readonly ModelRecord[] {
  const byModel = new Map<string, ModelCall[]>()

  for (const call of calls) {
    byModel.set(call.model, [...(byModel.get(call.model) ?? []), call])
  }

  return [...byModel]
    .map(([model, group]) => toRecord(model, independentCalls(group)))
    .sort((left, right) => left.model.localeCompare(right.model))
}

function toRecord(model: string, calls: readonly ModelCall[]): ModelRecord {
  const winCount = calls.filter((call) => isWinningReturn(call.outcome.returnPct)).length

  return {
    model,
    resolvedCount: calls.length,
    winCount,
    ...(calls.length >= MINIMUM_TRACK_RECORD_SAMPLE ? { winRate: winCount / calls.length } : {}),
  }
}
