import type { Market } from '@/trading/markets/types'
import { MS_PER_DAY } from '@/core/utils/time'
import { longestBarWindow } from '@/trading/markets/levels'

const DAYS_PER_WEEK = 7

/** Head-room over the weekend arithmetic, covering holidays and the gap between a sweep and the
 *  next factor run: with a five-session week's 1.4 from weekends, a 273-session lookback keeps
 *  about 1.46x its length in calendar days. */
const RETENTION_MARGIN = 1.05

/** How long stored market data must survive: the largest evidence window any registered market
 *  declares, converted from sessions to calendar days by that market's own weekend rule.
 *
 *  Derived rather than configured because the correct value is not a judgment — a sweep shorter
 *  than the longest evidence window deletes rows the factor pipeline re-requests on its next run,
 *  and no operator can be expected to recompute it when a market's lookback changes.
 */
export function resolveRetentionMs(markets: readonly Market[]): number {
  const days = markets.map(retentionDaysOf)

  return Math.ceil(Math.max(0, ...days)) * MS_PER_DAY
}

function retentionDaysOf(market: Market): number {
  const { evidenceSessions, defaultCalendar } = market.manifest
  const tradingDaysPerWeek = DAYS_PER_WEEK - defaultCalendar.weekendDays.length

  if (tradingDaysPerWeek <= 0) {
    return 0
  }

  return (
    (longestBarWindow(evidenceSessions) * DAYS_PER_WEEK * RETENTION_MARGIN) / tradingDaysPerWeek
  )
}
