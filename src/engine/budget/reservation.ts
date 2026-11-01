import type { CostReservation, CostTrackerSnapshot } from '@/engine/types/cost'
import type { RunView } from '@/engine/types/run'
import { type BudgetHaltDetail, RunHalted } from '@/core/errors'
import { scrubCredentials } from '@/core/security/credentials'
import { formatUsd } from '@/core/utils/cost'
import { emitIfExhausted } from '@/engine/budget/exhaustion'
import { isPositiveFinite, normalizeActualUsd } from '@/engine/budget/run-budget'
// Side-effect import: merges engine's BusEventMap declarations so bus.emit('budget_warning') typechecks.
import '@/engine/events'

type LlmCostAdmission =
  | { readonly status: 'admitted'; readonly reservation: CostReservation }
  | { readonly status: 'rejected'; readonly rejection: BudgetHaltDetail }

interface WarnPeriodInput {
  readonly period: 'daily' | 'monthly'
  readonly cap: number
  readonly warned: boolean
  readonly projectedUsd: number
  readonly spentUsd: number
  readonly now: number
}

// Required LLM work (turns, compaction): an insufficient budget halts the run.
export async function reserveRequiredLlmCost(
  run: RunView,
  estimateUsd: number
): Promise<CostReservation> {
  const admission = await admitLlmCost(run, estimateUsd)

  if (admission.status === 'rejected') {
    throw new RunHalted(
      'budget',
      rejectionMessage(run, estimateUsd, admission.rejection),
      admission.rejection
    )
  }

  return admission.reservation
}

// Optional LLM work (preference extraction): an insufficient budget skips the work, not the run.
export async function reserveOptionalLlmCost(
  run: RunView,
  estimateUsd: number,
  label: string
): Promise<CostReservation | undefined> {
  const admission = await admitLlmCost(run, estimateUsd)

  if (admission.status === 'rejected') {
    run.services.logger.warn('engine.optional_llm_skipped', {
      label: scrubCredentials(label),
      reason: admission.rejection,
    })

    return undefined
  }

  return admission.reservation
}

async function admitLlmCost(run: RunView, estimateUsd: number): Promise<LlmCostAdmission> {
  if (run.state.abort.signal.aborted) {
    throw new RunHalted('abort', 'run aborted')
  }

  // Screen before spending a rate-limit token: a caller that clearly cannot afford the call
  // must not queue behind (or starve) callers that can.
  const screenedAt = Date.now()
  const screened = capRejection(run, estimateUsd, run.services.costTracker.snapshot(screenedAt))

  if (screened !== undefined) {
    announceCapRejection(run, screened, screenedAt)

    return { status: 'rejected', rejection: screened }
  }

  await run.services.rateLimiter.acquire(
    { agentId: run.identity.agentId, userId: run.identity.userId },
    run.state.abort.signal
  )

  // The limiter never waits (it halts when over), but the await still yields to concurrent runs:
  // re-check against one fresh snapshot so spend they recorded meanwhile still trips the caps. No
  // await follows before reserve().
  const now = Date.now()
  const snapshot = run.services.costTracker.snapshot(now)
  const rejection = capRejection(run, estimateUsd, snapshot)

  if (rejection !== undefined) {
    announceCapRejection(run, rejection, now)

    return { status: 'rejected', rejection }
  }

  warnOncePerPeriod(run, { snapshot, estimateUsd, now })

  return { status: 'admitted', reservation: holdEstimate(run, estimateUsd) }
}

// Reserved on the run budget in the same synchronous section as the cost tracker: siblings sharing
// one pool ledger would otherwise each pass the remaining-budget check before any of them charges.
function holdEstimate(run: RunView, estimateUsd: number): CostReservation {
  const tracked = run.services.costTracker.reserve(estimateUsd)
  const budget = run.state.budget
  let hold = budget.reserve(estimateUsd)
  let leftoverUsd = isPositiveFinite(estimateUsd) ? estimateUsd : 0
  let released = false

  return {
    consume: (actualUsd: number): void => {
      tracked.consume(actualUsd)

      if (released) {
        return
      }

      // The caller charges the actual spend right after this returns; keeping the whole hold would
      // count that spend against its own reservation and halt a call that fit.
      hold?.settle(0)
      leftoverUsd = Math.max(0, leftoverUsd - normalizeActualUsd(actualUsd))
      hold = budget.reserve(leftoverUsd)
    },
    release: (): void => {
      released = true
      tracked.release()
      hold?.settle(0)
      hold = undefined
    },
  }
}

function capRejection(
  run: RunView,
  estimateUsd: number,
  snapshot: CostTrackerSnapshot
): BudgetHaltDetail | undefined {
  const dailyCap = run.env.config.budget.maxDailyUsd
  const monthlyCap = run.env.config.budget.maxMonthlyUsd

  // Only a configured cap can be bypassed by unrecorded spend; with caps off it is a reporting gap.
  if (snapshot.ledgerUnavailable && (dailyCap > 0 || monthlyCap > 0)) {
    return 'ledger_unavailable'
  }

  if (run.state.budget.remainingUsd() < estimateUsd) {
    return 'run_budget'
  }

  if (dailyCap > 0 && snapshot.dailySpentUsd + snapshot.reservedUsd + estimateUsd > dailyCap) {
    return 'daily_cap'
  }

  if (
    monthlyCap > 0 &&
    snapshot.monthlySpentUsd + snapshot.reservedUsd + estimateUsd > monthlyCap
  ) {
    return 'monthly_cap'
  }

  return undefined
}

function rejectionMessage(run: RunView, estimateUsd: number, rejection: BudgetHaltDetail): string {
  switch (rejection) {
    case 'run_budget':
      return `Estimated LLM call cost ${formatUsd(estimateUsd)} exceeds remaining per-run budget ${formatUsd(run.state.budget.remainingUsd())}`
    case 'daily_cap':
      return 'Daily cap would be exceeded by estimated LLM call cost'
    case 'monthly_cap':
      return 'Monthly cap would be exceeded by estimated LLM call cost'
    case 'agent_daily_cap':
      return 'Agent daily cap would be exceeded by estimated LLM call cost'
    case 'ledger_unavailable':
      return 'Spend cannot be recorded, so no further paid work is admitted'
  }
}

function warnOncePerPeriod(
  run: RunView,
  input: {
    readonly snapshot: CostTrackerSnapshot
    readonly estimateUsd: number
    readonly now: number
  }
): void {
  const { snapshot, estimateUsd, now } = input

  warnPeriod(run, {
    period: 'daily',
    cap: run.env.config.budget.maxDailyUsd,
    warned: snapshot.dailyWarned,
    projectedUsd: snapshot.dailySpentUsd + snapshot.reservedUsd + estimateUsd,
    spentUsd: snapshot.dailySpentUsd,
    now,
  })
  warnPeriod(run, {
    period: 'monthly',
    cap: run.env.config.budget.maxMonthlyUsd,
    warned: snapshot.monthlyWarned,
    projectedUsd: snapshot.monthlySpentUsd + snapshot.reservedUsd + estimateUsd,
    spentUsd: snapshot.monthlySpentUsd,
    now,
  })
}

function warnPeriod(run: RunView, input: WarnPeriodInput): void {
  if (
    input.cap <= 0 ||
    input.warned ||
    input.projectedUsd < input.cap * run.env.config.budget.softWarnRatio
  ) {
    return
  }

  run.services.costTracker.markWarned(input.period, input.now)
  run.services.logger.warn('budget.soft_warning', {
    period: input.period,
    spent: input.spentUsd,
    cap: input.cap,
  })
  run.services.bus.emit('budget_warning', {
    agentId: run.identity.agentId,
    period: input.period,
    spent: input.spentUsd,
    cap: input.cap,
  })
}

// The ledger and per-agent refusals say nothing about the shared caps; `emitIfExhausted` tells a spent
// cap from an estimate that would only cross it.
function announceCapRejection(run: RunView, rejection: BudgetHaltDetail, now: number): void {
  if (rejection === 'daily_cap' || rejection === 'monthly_cap' || rejection === 'run_budget') {
    emitIfExhausted(run.services, run.identity.agentId, now)
  }
}
