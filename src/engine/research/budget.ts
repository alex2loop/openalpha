import type { ResearchDepth } from '@/core/config/resolve'
import type { Budget } from '@/core/types/budget'
import type { BudgetSlice } from '@/engine/types/cost'
import { RunHalted } from '@/core/errors'
import { createBudget, settleReservation } from '@/engine/budget/run-budget'
import { createBudgetSlicesWithin } from '@/engine/budget/slices'
import { AGENT_BUDGET_FRACTION, MIN_PER_RUN_BUDGET_USD } from '@/engine/constants'

import type { ResearchBudgetPool, ResearchPhase } from './contracts'

const PHASE_WEIGHTS = {
  light: { plan: 0, crawl: 0.7, synthesize: 0.3, review: 0 },
  medium: { plan: 0.1, crawl: 0.45, synthesize: 0.25, review: 0.2 },
  deep: { plan: 0.1, crawl: 0.5, synthesize: 0.2, review: 0.2 },
} as const satisfies Record<ResearchDepth, Record<ResearchPhase, number>>

// Search fees land on the same crawl budget the cohort slices reserve. A cohort that reserved the
// whole remainder would leave nothing spendable, so the first fee of any size would halt the crawl.
const CRAWL_EXTERNAL_COST_RESERVE = 0.25
const RESEARCH_PHASES: readonly ResearchPhase[] = ['plan', 'crawl', 'synthesize', 'review']

export function researchBranchBudgetWeight(depth: ResearchDepth): number {
  return PHASE_WEIGHTS[depth].crawl
}

export function researchBranchCallCapacity(parent: Budget, depth: ResearchDepth): number {
  const remaining = parent.remainingUsd()

  if (remaining === Number.POSITIVE_INFINITY) {
    return Number.MAX_SAFE_INTEGER
  }

  const crawlUsd = remaining * AGENT_BUDGET_FRACTION * researchBranchBudgetWeight(depth)
  return Math.max(0, Math.floor(sliceablePhaseUsd('crawl', crawlUsd) / MIN_PER_RUN_BUDGET_USD))
}

// The pool always reserves the tool fraction so the parent run retains enough budget to consume
// the tool result and answer.
export function createResearchBudgetPool(parent: Budget, depth: ResearchDepth): ResearchBudgetPool {
  const allocationUsd = parent.remainingUsd() * AGENT_BUDGET_FRACTION

  const reservation = parent.reserve(allocationUsd)
  if (reservation === undefined) {
    throw new RunHalted('budget', 'insufficient budget for research')
  }

  const phaseBudgets = new Map<ResearchPhase, Budget>()

  for (const phase of RESEARCH_PHASES) {
    const weight = PHASE_WEIGHTS[depth][phase]

    if (weight > 0) {
      phaseBudgets.set(phase, createBudget(allocationUsd * weight))
    }
  }

  let settled = false

  return {
    take(phase: ResearchPhase, count: number, knownFutureCalls: number): readonly BudgetSlice[] {
      const cohortCount = Math.max(0, Math.floor(count))
      const futureCount = Math.max(0, Math.floor(knownFutureCalls))

      if (cohortCount === 0) {
        throw new RunHalted('budget', 'research cohort must contain at least one call')
      }

      const phaseBudget = phaseBudgets.get(phase)
      if (phaseBudget === undefined) {
        return []
      }

      const sliceableUsd = sliceablePhaseUsd(phase, phaseBudget.remainingUsd())
      const denominator = cohortCount + futureCount
      const cohortUsd =
        sliceableUsd === Number.POSITIVE_INFINITY
          ? sliceableUsd
          : (sliceableUsd * cohortCount) / denominator

      return createBudgetSlicesWithin(phaseBudget, cohortUsd, cohortCount)
    },
    chargeExternalCost(costUsd: number): void {
      const crawlBudget = phaseBudgets.get('crawl')

      if (crawlBudget === undefined) {
        throw new RunHalted('budget', 'research crawl budget is unavailable')
      }

      crawlBudget.charge(costUsd)
    },
    settle(): void {
      if (settled) {
        return
      }

      settled = true
      let totalSpent = 0

      for (const budget of phaseBudgets.values()) {
        totalSpent += budget.spentUsd
      }

      settleReservation(reservation, totalSpent)
    },
  }
}

// Crawl slices leave a share of their phase unreserved so `chargeExternalCost` has somewhere to
// land; every other phase makes no external calls and stays fully sliceable.
function sliceablePhaseUsd(phase: ResearchPhase, remainingUsd: number): number {
  return phase === 'crawl' ? remainingUsd * (1 - CRAWL_EXTERNAL_COST_RESERVE) : remainingUsd
}
