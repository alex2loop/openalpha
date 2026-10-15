import type { AgentId } from '@/core/ids'
import type { RunResult, RunState, RunView } from '@/engine/types/run'
import type { RunOnceDeps } from '@/engine/types/run-deps'
import { RunHalted } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { EMPTY_LLM_USAGE_TOTALS } from '@/core/types/usage'
import { MIN_PER_RUN_BUDGET_USD } from '@/engine/constants'
import { buildRunResult } from '@/engine/loop/finalize'

/** The `errorMessage` of a run refused because its agent spent its own daily cap. The scheduler
 *  recognises it as an uncounted halt, so an agent at its cap never climbs a job's failure ladder. */
export const AGENT_CAP_MESSAGE = 'Agent daily cap reached'

/** The `errorMessage` of a run refused because its agent is paused. Uncounted by the scheduler for
 *  the same reason: a paused agent's job is skipped, not failed. */
export const PAUSED_MESSAGE = 'Agent paused'

export function preflightRun(
  signals: readonly (AbortSignal | undefined)[],
  state: RunState
): RunResult | undefined {
  if (signals.some((signal) => signal?.aborted)) {
    return buildRunResult(state, 'aborted', {
      workStarted: false,
      errorMessage: 'Aborted before first turn',
    })
  }

  if (state.budget.remainingUsd() < MIN_PER_RUN_BUDGET_USD) {
    return buildRunResult(state, 'budget', {
      workStarted: false,
      errorMessage: 'Zero or sub-minimum budget at preflight',
    })
  }

  return undefined
}

/** A pause is a safety switch, so an unreadable one reads as paused: erring toward not running is
 *  the side that cannot spend or send anything the operator turned off. */
export async function isPausedFailClosed(
  deps: Pick<RunOnceDeps, 'agentPauses' | 'logger'>,
  id: AgentId
): Promise<boolean> {
  if (deps.agentPauses === undefined) {
    return false
  }

  try {
    return await deps.agentPauses.isPaused(id)
  } catch (err: unknown) {
    deps.logger.warn('agents.pause_read_failed', { agentId: id, err: formatErrForLog(err) })

    return true
  }
}

export function pausedResult(): RunResult {
  return {
    reason: 'error',
    text: '',
    workStarted: false,
    haltCode: 'agent_paused',
    errorMessage: PAUSED_MESSAGE,
    totals: EMPTY_LLM_USAGE_TOTALS,
  }
}

export function agentNotFoundResult(agentId: string): RunResult {
  return {
    reason: 'error',
    text: '',
    workStarted: false,
    errorMessage: `Agent not found: ${agentId}`,
    totals: EMPTY_LLM_USAGE_TOTALS,
  }
}

export function abortedBeforeStartResult(): RunResult {
  return {
    reason: 'aborted',
    text: '',
    workStarted: false,
    errorMessage: 'Aborted before first turn',
    totals: EMPTY_LLM_USAGE_TOTALS,
  }
}

export function assertRunTurnAllowed(run: RunView): void {
  if (run.state.abort.signal.aborted) {
    throw new RunHalted('abort', 'run aborted')
  }

  if (run.state.turn >= run.env.limits.maxTurns) {
    throw new RunHalted('turn_limit', `reached max_turns=${run.env.limits.maxTurns}`)
  }
}
