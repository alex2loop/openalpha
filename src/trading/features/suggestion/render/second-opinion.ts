import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import { isBookCall, withoutBookHoldReasons } from '@/trading/kernel/operator/focus'

/** What a reader is shown of a call. A focus call is a second opinion: the operator never sized it
 *  and its levels owe nothing to the book, so no holding, size, quantity, target weight, sector
 *  weight, raised stop or book-state hold reason is printed anywhere. Only the book's own call
 *  carries them. The levels, thesis and debate stand. */
export function shownCall(suggestion: StoredSuggestion): StoredSuggestion {
  if (isBookCall(suggestion)) {
    return suggestion
  }

  const { held: _held, raisedStopFrom: _raisedStopFrom, ...shown } = suggestion

  if (shown.action === 'hold') {
    return { ...shown, holdReasonCodes: withoutBookHoldReasons(shown.holdReasonCodes) }
  }

  const { sizePctNav, units, policyUnits, targetPctNav, concentration, ...actionable } = shown

  return actionable
}
