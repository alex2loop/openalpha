// A child reservation owns no mutable totals; only its engine-owned budget slice supplies the
// actual spend when it settles.
export interface BudgetReservation {
  settle(actualUsd: number): void
}

// A spend ceiling shared by a run and every child it delegates to. Lives in core, not engine:
// both `RunOptions.budgetSlice` and `ToolInvocationContext.budget` name it, and core/tool.ts
// cannot reach into engine.
export interface Budget {
  readonly limitUsd: number
  readonly spentUsd: number
  remainingUsd(): number
  charge(usd: number): void
  reserve(usd: number): BudgetReservation | undefined
}
