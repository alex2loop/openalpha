import type { CalendarPolicy } from '@/trading/kernel/config'
import type { InvestmentHorizon } from '@/trading/kernel/operator/profile'
import { INVESTMENT_HORIZONS } from '@/trading/kernel/operator/profile'

/** How long a suggestion is given to reach a level before it expires at the last close, counted in
 *  calendar days rather than sessions. A wait is what the operator lives through, and one session
 *  count is four weeks on a five-day market and under three on a continuous one - which left
 *  /reflect pooling outcomes measured over different spans. Per horizon for the same reason: a long
 *  segment is sized for an edge that runs for quarters, so four weeks of nothing falsifies its thesis
 *  no more than four days would falsify a swing call, and one span over both pooled the two records
 *  into a number describing neither. The long arm is one fiscal quarter, which is the cycle a long
 *  thesis is re-underwritten on, and is bounded above by `MAXIMUM_OUTCOME_LOOKBACK_DAYS`.
 *  A strategy constant beside the algorithm that applies it, not operator configuration: changing it
 *  changes what the recorded population means, so it belongs to the calculation version. */
export const OUTCOME_WINDOW_DAYS: Readonly<Record<InvestmentHorizon, number>> = Object.freeze({
  short: 28,
  long: 91,
})

/** A year, and the furthest back one resolution may reach. A suggestion older than this cannot be
 *  resolved from a trailing bar window that still contains its own session, and an outcome measured
 *  from the wrong sessions would be worse than leaving the row pending. `EXPIRY_BACKSTOP_MULTIPLE`
 *  windows of the longest horizon have to fit under it or the backstop is unreachable and such a row
 *  stays pending forever; in calendar days, like the window itself, so that holds on any market's
 *  week. As a session count it was a year on a five-day board and nine months on a continuous one. */
export const MAXIMUM_OUTCOME_LOOKBACK_DAYS = 365

const DAYS_PER_WEEK = 7

/** The window in one market's own sessions. Holidays are deliberately not modelled: a holiday
 *  shortens the bar count without shortening the wait, and this barrier measures the wait. */
export function outcomeWindowSessions(
  calendar: CalendarPolicy,
  horizon: InvestmentHorizon
): number {
  return toSessions(calendar, OUTCOME_WINDOW_DAYS[horizon])
}

/** The widest window any segment can declare, for a read that must span the horizon before the
 *  profile naming it has been read. Its consumers narrow; guessing a horizon here would not. */
export function longestOutcomeWindowSessions(calendar: CalendarPolicy): number {
  return Math.max(...INVESTMENT_HORIZONS.map((horizon) => outcomeWindowSessions(calendar, horizon)))
}

export function outcomeLookbackSessions(calendar: CalendarPolicy): number {
  return toSessions(calendar, MAXIMUM_OUTCOME_LOOKBACK_DAYS)
}

function toSessions(calendar: CalendarPolicy, days: number): number {
  const sessionsPerWeek = DAYS_PER_WEEK - calendar.weekendDays.length

  return Math.round((days * sessionsPerWeek) / DAYS_PER_WEEK)
}
