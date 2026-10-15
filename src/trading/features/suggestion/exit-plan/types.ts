import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { InstrumentRef } from '@/trading/kernel/instrument'

export interface PlanRecordedEntryOptions {
  readonly instrument: InstrumentRef
  /** The fill price on the write path. Absent on the tick, which plans from the settled close. */
  readonly entry?: number
  readonly now: number
  readonly signal: AbortSignal
}

export type RecordedPlanResult =
  | { readonly kind: 'planned'; readonly plan: StoredSuggestion }
  /** A plan already stands — a call, or a recorded plan the close has not passed — and nothing is
   *  written over it. */
  | { readonly kind: 'standing'; readonly plan: StoredSuggestion }
  | { readonly kind: 'unplanned'; readonly reason: 'market-unknown' | 'no-levels' | 'row-exists' }

export interface ExitPlanner {
  plan(options: PlanRecordedEntryOptions): Promise<RecordedPlanResult>
}
