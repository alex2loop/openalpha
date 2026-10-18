import type { SuggestionRunOptions } from '@/trading/features/suggestion/pipeline/types'
import type { StoredSuggestion, SuggestionIdentity } from '@/trading/features/suggestion/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import { bookHoldOf } from '@/trading/features/suggestion/pipeline/direction'
import { isRecordedPlan, isUndecidedHold } from '@/trading/features/suggestion/types'

export function lookbackOf(
  identity: SuggestionIdentity,
  sinceDay: TradingDay
): Omit<SuggestionIdentity, 'asOf'> & { readonly sinceDay: TradingDay } {
  return {
    market: identity.market,
    ticker: identity.ticker,
    strategyId: identity.strategyId,
    strategyVersion: identity.strategyVersion,
    focusKey: identity.focusKey,
    sinceDay,
  }
}

/** What a run may serve back as today's answer and cool down on. An undecided row is not an answer,
 *  so serving it back would let one outage stand as today's decision; a recorded plan is levels the
 *  system wrote, not a call, so it may neither answer nor block one; a restated call prices levels on
 *  a basis the market no longer publishes, and an unfilled call has no trade behind it to stand on.
 *  The three sites that ask —
 *  reuse, cooldown, and the persist takeover — read this one predicate so they cannot drift. */
export function isStandingAnswer(
  suggestion: StoredSuggestion,
  options: Pick<SuggestionRunOptions, 'deps' | 'request'>
): boolean {
  return !(
    isUndecidedHold(suggestion) ||
    isRecordedPlan(suggestion) ||
    isRestatedCall(suggestion) ||
    isUnfilledCall(suggestion) ||
    isShallowerDebate(suggestion, options)
  )
}

function isRestatedCall(suggestion: StoredSuggestion): boolean {
  return suggestion.action !== 'hold' && suggestion.restatedAt !== undefined
}

function isUnfilledCall(suggestion: StoredSuggestion): boolean {
  return suggestion.action !== 'hold' && suggestion.unfilledAt !== undefined
}

/** Its order stood through `until` and is gone, even before the daemon closes the row. */
export function isLapsedLimit(suggestion: StoredSuggestion, asOf: TradingDay): boolean {
  return (
    suggestion.action === 'buy' &&
    suggestion.restingEntry !== undefined &&
    suggestion.restingEntry.until < asOf
  )
}

/** Depth ratchets up, never down: a full-debate request re-runs past a lean verdict and supersedes
 *  it, while a lean request happily reuses a full one. A row with no stored debate was decided by
 *  the deterministic gates, and a hold the book decided by neither - no depth can overturn either,
 *  so both satisfy a configured depth. A typed `full` still re-runs past a lean row. */
function isShallowerDebate(
  suggestion: StoredSuggestion,
  options: Pick<SuggestionRunOptions, 'deps' | 'request'>
): boolean {
  if (suggestion.debate?.mode !== 'lean') {
    return false
  }

  if (options.request.debateMode === 'full') {
    return true
  }

  return options.deps.policy.debateMode === 'full' && bookHoldOf(suggestion) === undefined
}
