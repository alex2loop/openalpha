import type { HeldPosition } from '@/trading/features/suggestion/exposure'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { InvestmentHorizon } from '@/trading/kernel/operator/profile'
import type { Market } from '@/trading/markets/types'
import { outcomeWindowSessions } from '@/trading/features/suggestion/pipeline/outcome-window'

/** Below this the position has not moved far enough in either direction for the window to have
 *  decided anything, which is what makes the wait itself the evidence. */
const STALE_PROGRESS_FRACTION = 0.02

interface OutcomeWindowInput {
  readonly market: Pick<Market, 'manifest'>
  readonly held: HeldPosition
  readonly asOf: TradingDay
  /** The segment horizon this holding sits in, so the wait it is judged against is the one its own
   *  calls are scored over. Resolved by the caller through `horizonFor`, never from the manifest's
   *  seed, which the operator's profile overrides. */
  readonly horizon: InvestmentHorizon
}

interface PositionStaleInput extends OutcomeWindowInput {
  /** The mark in the market's own currency, so it compares against the cost beside it. */
  readonly price: number
}

/** Whether the holding has waited out the window the outcome scorer measures a call over. Answered
 *  without a price so a caller can skip the quote for a position too young to be stale whatever it
 *  is worth. The window is counted in the market's default sessions and stepped on its own calendar
 *  — a window in sessions is a different span in days, and the two are not interchangeable — over
 *  the segment's own horizon, and from the day half the position was held, so a fresh add is not
 *  sold as stale on its first lot's clock. False without an open lot, which is a fold that saw
 *  nothing to wait on. */
export function isPastOutcomeWindow(input: OutcomeWindowInput): boolean {
  const { manifest } = input.market
  const { medianAcquiredAt } = input.held

  if (medianAcquiredAt === undefined) {
    return false
  }

  const due = manifest.calendar.addTradingDays(
    medianAcquiredAt,
    outcomeWindowSessions(manifest.defaultCalendar, input.horizon)
  )

  return due <= input.asOf
}

/** A holding that waited out its window and went nowhere: the same vertical barrier the outcome
 *  scorer applies to a call, asked of a position. */
export function isPositionStale(input: PositionStaleInput): boolean {
  const { price } = input
  const { unitCostNative } = input.held

  if (!(unitCostNative > 0 && price > 0)) {
    return false
  }

  return (
    isPastOutcomeWindow(input) && Math.abs(price / unitCostNative - 1) < STALE_PROGRESS_FRACTION
  )
}
