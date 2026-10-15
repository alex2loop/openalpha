import type { Logger } from '@/core/logging/logger'
import type { OnStreamEvent } from '@/core/stream-events'
import type { SettledProviderResponse } from '@/engine/llm-turn'
import type { RunBookkeeping } from '@/engine/loop/context'
import type { RunView } from '@/engine/types/run'
import { formatErrForLog } from '@/core/security/credentials'

export function runStreamListener(
  onChunk: OnStreamEvent | undefined,
  logger: Logger
): OnStreamEvent | undefined {
  if (onChunk === undefined) {
    return undefined
  }

  // A listener that throws throws on every chunk, so one record per turn is the whole signal.
  let reported = false

  return (event): void => {
    try {
      onChunk(event)
    } catch (err: unknown) {
      if (!reported) {
        reported = true
        logger.warn('engine.on_chunk_threw', { err: formatErrForLog(err) })
      }
    }
  }
}

// End-to-end call latency (performance.now, not the wall clock) stays separate from each
// durable per-attempt latency; token/cost figures are the call's settled aggregates.
export function emitTurnMetric(input: {
  readonly run: RunView
  readonly estimator: RunBookkeeping['estimator']
  readonly onChunk: OnStreamEvent | undefined
  readonly settled: SettledProviderResponse
  readonly latencyMs: number
}): void {
  const { run, estimator, onChunk, settled, latencyMs } = input
  const { contextWindow } = run.env.limits
  const contextPct =
    contextWindow > 0
      ? Math.min(100, Math.round(((estimator?.tokens ?? 0) / contextWindow) * 100))
      : 0

  runStreamListener(
    onChunk,
    run.services.logger
  )?.({
    type: 'turn_metric',
    model: settled.response.model,
    provider: settled.response.providerModel.provider,
    latencyMs,
    contextPct,
    costUsd: settled.callCostUsd,
    inputTokens: settled.callUsage.input,
    outputTokens: settled.callUsage.output,
  })
}
