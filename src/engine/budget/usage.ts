import type { LLMUsageTotals } from '@/core/types/usage'
import { ValidationError } from '@/core/errors'

export function addExternalCost(totals: LLMUsageTotals, costUsd: number): LLMUsageTotals {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new ValidationError('external cost must be finite and non-negative')
  }

  return { ...totals, costUsd: totals.costUsd + costUsd }
}

/** A delegated child's calls are billed to the same session, so they add here exactly as they do in
 *  the stored fold the slash footer reads — the loop's own `maxTurns` bound counts `state.turn`,
 *  which this total no longer carries. */
export function addUsage(left: LLMUsageTotals, right: LLMUsageTotals): LLMUsageTotals {
  return {
    costUsd: left.costUsd + right.costUsd,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    modelCalls: left.modelCalls + right.modelCalls,
    ...namedModel(left, right.modelCalls === 0 ? left.modelName : right.modelName),
  }
}

/** The same rule the stored fold applies, held by an accumulator that sees one attempt at a time:
 *  a name survives only while every billed call carried it, and `modelCalls === 0` is what tells
 *  "nothing has billed yet" apart from "several models did". */
export function namedModel(
  totals: LLMUsageTotals,
  model: string | undefined
): { modelName?: string } {
  if (totals.modelCalls === 0) {
    return model === undefined ? {} : { modelName: model }
  }

  return totals.modelName === model && model !== undefined ? { modelName: model } : {}
}
