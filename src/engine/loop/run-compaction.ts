import type { RunBookkeeping } from '@/engine/loop/context'
import type { Compactor, ResolvedRunLimits, RunView } from '@/engine/types/run'
import { RunHalted } from '@/core/errors'
import { CONTEXT_OVERFLOW_PROBE_STEPS } from '@/engine/constants'
import { estimateTokens } from '@/engine/loop/limits'

// Token room the transcript may occupy before compaction triggers. <= 0 disables compaction.
export function compactionRoomTokens(limits: ResolvedRunLimits): number {
  return (limits.contextWindow - limits.maxTokens) * limits.compactionThreshold
}

export function isCompactionNeeded(run: RunView, bookkeeping: RunBookkeeping): boolean {
  const room = compactionRoomTokens(run.env.limits)
  const tokens = bookkeeping.estimator?.tokens ?? estimateTokens(run.state.messages.history)

  return room > 0 && tokens > room
}

export async function compactOnce(
  run: RunView,
  bookkeeping: RunBookkeeping,
  compactor: Compactor
): Promise<void> {
  const { maxCompactionPasses } = run.env.limits

  // A full context window, not a provider fault: `llm_error` would rebalance a fallback model.
  if (bookkeeping.compactionPasses >= maxCompactionPasses) {
    throw new RunHalted(
      'length_limit',
      `reached the compaction pass limit (${maxCompactionPasses})`
    )
  }

  const before = estimateTokens(run.state.messages.history)

  await compactor.compact(run)
  delete bookkeeping.estimator
  bookkeeping.compactionPasses += 1

  // Re-sending an unchanged transcript would only re-bill the same overflow.
  if (estimateTokens(run.state.messages.history) >= before) {
    throw new RunHalted('length_limit', 'compaction could not shrink the transcript')
  }
}

// The one sanctioned in-place limit mutation: the provider just told us the window we assumed
// is wrong, and every later turn of this run must use the corrected value.
export function shrinkContextWindow(run: RunView): void {
  const current = run.env.limits.contextWindow
  const next = CONTEXT_OVERFLOW_PROBE_STEPS.find((step) => step < current)

  if (next !== undefined) {
    run.env.limits.contextWindow = next
  }
}
