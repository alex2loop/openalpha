import type { ActionableSuggestion, OutcomeResolution } from '@/trading/features/suggestion/types'
import type { Candle } from '@/trading/kernel/market/market-data'

/** How far the price ran against and for a call before it closed, in risk units: multiples of the
 *  distance from the scored entry to the plan's stop. Both are zero or more. */
interface OutcomeExcursion {
  readonly adverse: number
  readonly favorable: number
}

type ExcursionCall = Pick<ActionableSuggestion, 'action' | 'entry' | 'stop'>

/** A resolved result carrying the excursion over the bars the scorer replayed from the fill to the
 *  exit bar; any other result passes through. */
export function withExcursion(
  result: OutcomeResolution,
  call: ExcursionCall,
  bars: readonly Candle[]
): OutcomeResolution {
  if (result.kind !== 'resolved') {
    return result
  }

  const excursion = excursionOf(
    call,
    bars.filter((bar) => bar.at <= result.outcome.exitDay)
  )

  return excursion === undefined
    ? result
    : {
        kind: 'resolved',
        outcome: {
          ...result.outcome,
          adverseExcursion: excursion.adverse,
          favorableExcursion: excursion.favorable,
        },
      }
}

/** Gross of fees, from the price the scorer graded from and measured against the plan's stop, never
 *  a trailed one. A resting limit's fill bar counts whole, as the scorer reads it. Absent where the
 *  call has no stop distance or no bar to measure. */
function excursionOf(call: ExcursionCall, bars: readonly Candle[]): OutcomeExcursion | undefined {
  const risk = Math.abs(call.entry - call.stop)

  if (!(risk > 0) || bars.length === 0) {
    return undefined
  }

  const lowest = Math.min(...bars.map((bar) => bar.low))
  const highest = Math.max(...bars.map((bar) => bar.high))
  const down = Math.max(0, call.entry - lowest) / risk
  const up = Math.max(0, highest - call.entry) / risk
  const excursion =
    call.action === 'buy' ? { adverse: down, favorable: up } : { adverse: up, favorable: down }

  return Number.isFinite(excursion.adverse) && Number.isFinite(excursion.favorable)
    ? excursion
    : undefined
}
