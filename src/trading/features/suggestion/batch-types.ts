import type { ChannelId } from '@/core/channels'
import type { AgentId, RunId, SessionId } from '@/core/ids'
import type { Budget } from '@/core/types/budget'
import type { Locale } from '@/core/types/locale'
import type { SuggestionRunResult } from '@/trading/features/suggestion/types'
import type { DebateMode, SuggestionPolicy } from '@/trading/kernel/config'
import type { MarketRef, PortfolioSegment, Ticker } from '@/trading/kernel/instrument'
import type { SleeveBreach } from '@/trading/kernel/operator/exposure'
import type { RunFocus } from '@/trading/kernel/operator/focus'
import type { StageReporter } from '@/trading/kernel/surface/tool-progress'

/** What a batch run is asked to do, kept apart from what a suggestion *is*: these shapes name the
 *  names, the budget and the channel a sweep runs under, and nothing here appears in a stored row. */

export interface SuggestionBatchItem {
  readonly locale: Locale
  readonly ticker: Ticker
  readonly market?: MarketRef
  /** Operator-only, and per name rather than per batch: a sweep has no way to ask for it. */
  readonly force?: boolean
}

/** The pure batch entry point's input: every name is already resolved and the policy slice it
 *  applies is supplied, because a pipeline function reads no config. */
export interface SuggestionBatchOptions {
  readonly items: readonly SuggestionBatchItem[]
  /** Every sleeve the items resolved to: the scope of the batch's one portfolio read. */
  readonly segments: readonly PortfolioSegment[]
  readonly channel: ChannelId
  readonly billingSessionId: SessionId | null
  readonly parentRunId?: RunId
  /** The focus every call in the batch is made under, and the agent asking. */
  readonly focus: RunFocus
  readonly agentId?: AgentId
  readonly billingAgentId?: AgentId
  readonly budget: Budget
  readonly policy: SuggestionPolicy
  /** The mode the operator typed, when they typed one. `policy.debateMode` already carries it, but
   *  the pipeline needs to know it was asked for: a typed depth is never downgraded. */
  readonly debateMode?: DebateMode
  readonly now: number
  readonly signal: AbortSignal
  /** Forwarded from the invoking surface; the pipeline reports stage keys through it. */
  readonly progress?: StageReporter
}

/** A surface either names the instruments itself or asks for the caller's watchlist, which only
 *  the service can expand — a tool holds no profile store. The service supplies the policy. */
export type SuggestionBatchScope =
  | { readonly kind: 'items'; readonly items: readonly SuggestionBatchItem[] }
  | { readonly kind: 'watchlist'; readonly locale: Locale }

export interface SuggestionBatchRequest {
  readonly scope: SuggestionBatchScope
  readonly channel: ChannelId
  readonly billingSessionId: SessionId | null
  readonly parentRunId?: RunId
  readonly focus: RunFocus
  readonly agentId?: AgentId
  readonly billingAgentId?: AgentId
  /** A caller already inside a budgeted run passes its own slice; one starting a batch of its own
   *  omits it and the service mints the configured budget, exactly as `run` does. */
  readonly budget?: Budget
  readonly debateMode?: DebateMode
  readonly now: number
  readonly signal: AbortSignal
  /** Forwarded from the invoking surface; the pipeline reports stage keys through it. */
  readonly progress?: StageReporter
}

/** A budget the batch's buys would spend past together, though each was sized to fit it alone:
 *  every item sizes against the same pre-batch cash and open-risk room. Weights are fractions of
 *  NAV, as in `SleeveBreach`. */
export interface BatchOvercommit {
  readonly kind: 'cash' | 'open-risk'
  /** Cash only: set when the shortfall is what one market's venues can reach, not the whole
   *  book's spendable cash. */
  readonly market?: MarketRef
  readonly needPctNav: number
  readonly availablePctNav: number
}

/** What one batch produced: a verdict per name, and the ceilings every one of those calls taken
 *  together would cross. Batch-scoped and never stored — a breach is a fact about the set, and a
 *  row re-read alone was never part of one. */
export interface SuggestionBatchResult {
  readonly results: readonly SuggestionRunResult[]
  readonly breaches: readonly SleeveBreach[]
  readonly overcommit: readonly BatchOvercommit[]
}
