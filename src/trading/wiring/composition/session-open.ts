import type { MarketRef } from '@/trading/kernel/instrument'
import type { MarketRegistry } from '@/trading/markets/types'
import { sessionPhase } from '@/trading/markets/calendar'

/** Whether any of these markets is trading, lunch break included. A continuous market (crypto) has
 *  no session to protect, and `pre-open` / `post-close` do not count: a VN trading day reads
 *  `pre-open` from midnight to the open, which would hold every night. */
export function isAnySessionOpen(
  markets: MarketRegistry,
  refs: ReadonlySet<MarketRef>,
  now: number
): boolean {
  for (const ref of refs) {
    const calendar = markets.find(ref)?.manifest.calendar

    if (calendar === undefined || calendar.continuous) {
      continue
    }

    const phase = sessionPhase(calendar, now)

    if (phase === 'open' || phase === 'break') {
      return true
    }
  }

  return false
}
