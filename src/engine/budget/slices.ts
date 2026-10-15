import type { BudgetReservation } from '@/core/types/budget'
import type { Budget, BudgetSlice } from '@/engine/types/cost'
import {
  type BudgetLedger,
  chargeBudget,
  createBudgetLedger,
  normalizeUsd,
  remainingBudgetUsd,
  reserveBudget,
  settleReservation,
} from '@/engine/budget/run-budget'
import { MIN_PER_RUN_BUDGET_USD } from '@/engine/constants'

interface CohortPool {
  readonly ledger: BudgetLedger
  readonly reservation: BudgetReservation
  unsettled: number
}

// Reserved on the parent up front, settled once every slice has settled, so an underspending child
// leaves its remainder to a sibling. Callers allocate less than the whole remainder so the parent
// keeps enough to consume the results. A runaway child can drain the pool before a sibling's first
// call; per-slice ceilings are the upgrade path if that shows up.
export function createBudgetSlicesWithin(
  total: Budget,
  allocationUsd: number,
  parts: number
): readonly BudgetSlice[] {
  const count = normalizeParts(parts)

  if (count === 0) {
    return []
  }

  const normalizedUsd = normalizeUsd(allocationUsd)

  if (normalizedUsd > total.remainingUsd() || normalizedUsd / count < MIN_PER_RUN_BUDGET_USD) {
    return []
  }

  const reservation = total.reserve(normalizedUsd)

  if (reservation === undefined) {
    return []
  }

  const pool: CohortPool = {
    ledger: createBudgetLedger(normalizedUsd),
    reservation,
    unsettled: count,
  }

  return Array.from({ length: count }, () => new RunBudgetSlice(pool))
}

class RunBudgetSlice implements BudgetSlice {
  private readonly pool: CohortPool
  private settled = false

  constructor(pool: CohortPool) {
    this.pool = pool
  }

  get limitUsd(): number {
    return this.pool.ledger.limitUsd
  }

  get spentUsd(): number {
    return this.pool.ledger.spentUsd
  }

  remainingUsd(): number {
    return remainingBudgetUsd(this.pool.ledger)
  }

  charge(usd: number): void {
    chargeBudget(this.pool.ledger, usd)
  }

  reserve(usd: number): BudgetReservation | undefined {
    return reserveBudget(this.pool.ledger, usd)
  }

  settle(): void {
    if (this.settled) {
      return
    }

    this.settled = true
    this.pool.unsettled -= 1

    if (this.pool.unsettled === 0) {
      settleReservation(this.pool.reservation, this.pool.ledger.spentUsd)
    }
  }
}

function normalizeParts(parts: number): number {
  return Number.isInteger(parts) && parts > 0 ? parts : 0
}
