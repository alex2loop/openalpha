import type { AgentId, LLMAttemptId, UserId } from '@/core/ids'
import type { ProviderModelId } from '@/core/llm'
import type { TokenUsage } from '@/core/stream-events'
import type { Budget } from '@/core/types/budget'
import type { CostSource, LLMAttemptInput } from '@/core/types/usage'

// Budget is declared in core so `ToolInvocationContext` can name it; engine stays its home import.
export type { Budget } from '@/core/types/budget'

// Consumer-side interface: the engine names the durable-attempt write; persistence implements it and
// the composition root binds it. Failures propagate — skipping one would corrupt durable usage.
export interface LLMAttemptSink {
  record(attempt: LLMAttemptInput): Promise<void>
}

// Money already paid to a provider that the attempt store would not accept. The attempt id is what
// makes it reconcilable: a commit whose acknowledgement was lost lands in both ledgers.
export interface UnrecordedSpend {
  readonly id: LLMAttemptId
  readonly costUsd: number
  readonly settledAt: number
}

export interface UnrecordedSpendLoad {
  readonly entries: readonly UnrecordedSpend[]
  /** An unreadable line survives in the log, so spend is understated by an unknown amount. */
  readonly damaged: boolean
  /** Named in the operator-facing error: clearing the damage means editing this file. */
  readonly path: string
}

// Fallback ledger for spend the attempt store rejected, kept outside that store so a restart can
// still charge it against the caps. `load` prunes entries whose month can no longer be affected.
export interface UnrecordedSpendLog {
  append(entry: UnrecordedSpend): Promise<void>
  load(now: number): Promise<UnrecordedSpendLoad>
}

// One recorded charge: the billed USD and where its price came from — a finite non-negative
// provider-reported `costUsd` is authoritative, otherwise the price resolution (override →
// static table → conservative fallback).
export interface CostCharge {
  readonly costUsd: number
  readonly costSource: CostSource
  readonly exceededCap?: 'daily' | 'monthly'
}

export interface CostTrackerSnapshot {
  readonly dailySpentUsd: number
  readonly monthlySpentUsd: number
  readonly reservedUsd: number
  readonly dailyWarned: boolean
  readonly monthlyWarned: boolean
  /** Spend has outrun the durable ledger, so the caps can no longer be proven. */
  readonly ledgerUnavailable: boolean
}

// Handle over one admitted estimate: each settled attempt consumes its actual cost, and the
// opener releases only the unconsumed remainder. Both are synchronous and idempotent after
// release, so `spent + reserved` never counts one attempt as both actual and fully reserved.
export interface CostReservation {
  consume(actualUsd: number): void
  release(): void
}

// Every method takes the caller's one epoch-ms read so in-memory day/month attribution stays on
// the same UTC boundary as the durable attempt row; nothing here reads the clock itself.
export interface CostTracker {
  snapshot(at: number): CostTrackerSnapshot
  markWarned(period: 'daily' | 'monthly', at: number): void
  hydrate(totals: { readonly dayUsd: number; readonly monthUsd: number; readonly at: number }): void
  reserve(estimateUsd: number): CostReservation
  record(id: ProviderModelId, usage: TokenUsage, settledAt: number): CostCharge
  markLedgerUnavailable(): void
}

export interface BudgetSlice extends Budget {
  settle(): void
}

export interface RateLimitKey {
  readonly agentId: AgentId
  readonly userId: UserId
}

export interface RateLimiter {
  acquire(key: RateLimitKey, signal: AbortSignal): Promise<void>
}
