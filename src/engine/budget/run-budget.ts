import type { ResolvedConfig } from '@/core/config/resolve'
import type { BudgetReservation } from '@/core/types/budget'
import type { Budget } from '@/engine/types/cost'
import { RunHalted } from '@/core/errors'
import { formatUsd } from '@/core/utils/cost'

export interface BudgetLedger {
  readonly limitUsd: number
  spentUsd: number
  reservedUsd: number
}

export function createBudget(limitUsd: number): Budget {
  return new RunBudget(limitUsd)
}

export function createBudgetLedger(limitUsd: number): BudgetLedger {
  return { limitUsd: normalizeUsd(limitUsd), spentUsd: 0, reservedUsd: 0 }
}

export function remainingBudgetUsd(ledger: BudgetLedger): number {
  return Math.max(0, ledger.limitUsd - ledger.spentUsd - ledger.reservedUsd)
}

export function chargeBudget(ledger: BudgetLedger, usd: number): void {
  if (!isPositiveFinite(usd)) {
    return
  }

  // Record before halting: the cost was already incurred (post-hoc actual), so dropping the
  // charge on the halt path would under-report real spend.
  ledger.spentUsd += usd

  if (ledger.spentUsd + ledger.reservedUsd > ledger.limitUsd) {
    // A delegated child's limit is a slice of the parent, never a round configured cap.
    throw new RunHalted('budget', `per-run budget cap of ${formatUsd(ledger.limitUsd)} reached`)
  }
}

export function reserveBudget(ledger: BudgetLedger, usd: number): BudgetReservation | undefined {
  if (!isReservableUsd(usd)) {
    return undefined
  }

  // Holding Infinity would leave remainingUsd() reading 0 until the reservation settles.
  const heldUsd = ledger.limitUsd === Number.POSITIVE_INFINITY ? 0 : usd

  if (heldUsd > remainingBudgetUsd(ledger)) {
    return undefined
  }

  ledger.reservedUsd += heldUsd
  let settled = false

  return {
    settle(actualUsd: number): void {
      if (settled) {
        return
      }

      settled = true
      releaseReservation(ledger, heldUsd)
      chargeBudget(ledger, actualUsd)
    },
  }
}

// A cohort's parent reservation settles after its results are paid for: a cap tripped by that
// final charge must not discard them, so the halt is dropped here.
export function settleReservation(reservation: BudgetReservation, spentUsd: number): void {
  try {
    reservation.settle(spentUsd)
  } catch (err: unknown) {
    if (err instanceof RunHalted) {
      return
    }

    throw err
  }
}

export function normalizeUsd(usd: number): number {
  if (usd === Number.POSITIVE_INFINITY) {
    return usd
  }

  return isPositiveFinite(usd) ? usd : 0
}

export function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function normalizeActualUsd(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

function isReservableUsd(value: number): boolean {
  return isPositiveFinite(value) || value === Number.POSITIVE_INFINITY
}

function releaseReservation(ledger: BudgetLedger, reservedUsd: number): void {
  ledger.reservedUsd = Math.max(0, ledger.reservedUsd - reservedUsd)
}

class RunBudget implements Budget {
  private readonly ledger: BudgetLedger

  constructor(limitUsd: number) {
    this.ledger = createBudgetLedger(limitUsd)
  }

  get limitUsd(): number {
    return this.ledger.limitUsd
  }

  get spentUsd(): number {
    return this.ledger.spentUsd
  }

  remainingUsd(): number {
    return remainingBudgetUsd(this.ledger)
  }

  charge(usd: number): void {
    chargeBudget(this.ledger, usd)
  }

  reserve(usd: number): BudgetReservation | undefined {
    return reserveBudget(this.ledger, usd)
  }
}

export function createConfiguredRunBudget(config: ResolvedConfig): Budget {
  const daily = capOrInfinity(config.budget.maxDailyUsd)
  const perRun = capOrInfinity(config.budget.maxPerRunUsd)

  return createBudget(Math.min(daily, perRun))
}

function capOrInfinity(usd: number): number {
  return usd > 0 ? usd : Number.POSITIVE_INFINITY
}
