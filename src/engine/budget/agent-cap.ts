import type { AgentProfile } from '@/engine/types/agent'
import type { RunResult } from '@/engine/types/run'
import type { RunOnceDeps } from '@/engine/types/run-deps'
import { formatErrForLog } from '@/core/security/credentials'
import { EMPTY_LLM_USAGE_TOTALS } from '@/core/types/usage'
import { MIN_PER_RUN_BUDGET_USD } from '@/engine/constants'
import { AGENT_CAP_MESSAGE } from '@/engine/loop/preflight'

type AgentCapDeps = Pick<RunOnceDeps, 'agentSpentToday' | 'logger'>

/** Refuses a root run whose billing agent has spent its own daily cap. The cap is soft by design:
 *  it is a read, not a reservation, so two runs admitted at the same moment both pass and an admitted
 *  run may finish past it - the per-run cap still bounds each one. A failed read fails open, so a
 *  ledger outage never silences an agent that was never over its cap. */
export async function agentCapRejection(
  deps: AgentCapDeps,
  billing: AgentProfile | undefined,
  nowMs: number
): Promise<RunResult | undefined> {
  if (billing?.maxDailyUsd === undefined || deps.agentSpentToday === undefined) {
    return undefined
  }

  const spentUsd = await readSpend(deps, billing, nowMs)

  if (spentUsd === undefined || billing.maxDailyUsd - spentUsd >= MIN_PER_RUN_BUDGET_USD) {
    return undefined
  }

  deps.logger.warn('agents.budget_exhausted', {
    agentId: billing.id,
    spentUsd,
    capUsd: billing.maxDailyUsd,
  })

  return {
    reason: 'budget',
    text: '',
    workStarted: false,
    haltCode: 'budget',
    haltDetail: 'agent_daily_cap',
    errorMessage: AGENT_CAP_MESSAGE,
    totals: EMPTY_LLM_USAGE_TOTALS,
  }
}

async function readSpend(
  deps: AgentCapDeps,
  billing: AgentProfile,
  nowMs: number
): Promise<number | undefined> {
  try {
    return await deps.agentSpentToday?.(billing.id, nowMs)
  } catch (err: unknown) {
    deps.logger.warn('agents.cap_read_failed', {
      agentId: billing.id,
      err: formatErrForLog(err),
    })

    return undefined
  }
}
