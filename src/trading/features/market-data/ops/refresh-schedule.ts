import type { RefreshAnchor } from '@/trading/kernel/market/refresh'
import type { Market, MarketRegistry } from '@/trading/markets/types'

/** Warm-up ahead of the open so morning briefs and screens read fresh data without paying the
 *  fetch inline. Sits before the earliest brief send time (08:15 for a 09:00 open). */
const PRE_OPEN_LEAD_MS = 3_600_000
/** A tick landing closer than this joins the next one instead of firing twice back to back. */
const MINIMUM_DELAY_MS = 60_000

/** Calendar-aligned delay to the next refresh: once each session's tape has settled (capturing the
 *  closing auction the same evening) and shortly before each open (the warm-up), with the configured
 *  interval as the fallback ceiling for an empty registry. A continuous market settles at the UTC
 *  day rollover and never opens, so it anchors on that rollover alone. */
export function nextRefreshDelayMs(
  markets: MarketRegistry,
  now: number,
  intervalMs: number
): number {
  const anchors = markets.list().flatMap((market) => sessionAnchors(market, now))
  const horizon = now + MINIMUM_DELAY_MS
  const next = anchors.filter((at) => at > horizon).sort((left, right) => left - right)[0]

  return next === undefined ? intervalMs : Math.min(intervalMs, next - now)
}

/** The upcoming schedule anchors for one market, so `/refresh` names when the loop fires next.
 *  Only future instants: a past anchor is a time the loop already passed, not a plan. */
export function refreshAnchorsForMarket(market: Market, now: number): readonly RefreshAnchor[] {
  const calendar = market.manifest.calendar
  const today = calendar.dayAt(now)
  const first = calendar.isTradingDay(today) ? today : calendar.addTradingDays(today, 1)
  const days = [first, calendar.addTradingDays(first, 1)]

  const anchors: readonly RefreshAnchor[] = days.flatMap((day) => [
    { kind: 'tape-final' as const, at: calendar.tapeFinalAt(day), day },
    ...(calendar.continuous
      ? []
      : [{ kind: 'pre-open' as const, at: calendar.sessionOpenAt(day) - PRE_OPEN_LEAD_MS, day }]),
  ])

  return [...anchors].filter((anchor) => anchor.at > now).sort((left, right) => left.at - right.at)
}

/** Tape-settle instants for today's and the next session, plus the open-lead warm-up for a market
 *  that has an open. Two sessions are enough: the earliest future anchor always falls inside them. */
function sessionAnchors(market: Market, now: number): readonly number[] {
  return refreshAnchorsForMarket(market, now).map((anchor) => anchor.at)
}
