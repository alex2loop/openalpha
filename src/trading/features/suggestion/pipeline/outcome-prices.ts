import type { ActionableSuggestion } from '@/trading/features/suggestion/types'
import type { OutcomeStatus } from '@/trading/kernel/conviction'
import type { Candle } from '@/trading/kernel/market/market-data'

/** What the exit price and the return read of a call. */
type PricedCall = Pick<ActionableSuggestion, 'action' | 'entry' | 'target'>

// A target exits at its level, unless the bar gapped through it before the session even opened —
// a level inside the open-to-close range never actually traded there. An expiry exits at the last
// close.
export function exitPriceFor(
  status: Exclude<OutcomeStatus, 'stop'>,
  bar: Candle,
  suggestion: PricedCall
): number {
  return status === 'target' ? exitPriceAt(bar, suggestion, suggestion.target) : bar.close
}

export function exitPriceAt(bar: Candle, suggestion: PricedCall, level: number): number {
  return openedBeyond(bar, suggestion, level) ? bar.open : level
}

export function openedBeyondStop(bar: Candle, suggestion: PricedCall, stop: number): boolean {
  return suggestion.action === 'buy' ? bar.open <= stop : bar.open >= stop
}

function openedBeyond(bar: Candle, suggestion: PricedCall, level: number): boolean {
  return suggestion.action === 'buy' ? bar.open >= level : bar.open <= level
}

/** A `reduce` returns the negation: a reduce that avoided a fall is a win. The round-trip fee is a
 *  cost regardless of direction, so it always subtracts. */
export function directionalReturn(suggestion: PricedCall, exitPrice: number, fee: number): number {
  const move = (exitPrice - suggestion.entry) / suggestion.entry
  const directional = suggestion.action === 'buy' ? move : -move

  return directional - fee
}
