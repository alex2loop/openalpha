import type { CalendarPolicy } from '@/trading/kernel/config'
import type { TradingDay } from '@/trading/kernel/instrument'
import { yearOf } from '@/trading/sources/rows/normalization'

const MAXIMUM_CACHED_YEARS = 32

/** Whether the policy's own rules close a day. A year's closures are worked out once; the years
 *  asked about are few, and the cap keeps a walk over a malformed range from growing the map
 *  without end. */
export function createRuleClosures(
  policy: CalendarPolicy,
  isWeekend: (day: TradingDay) => boolean
): (day: TradingDay) => boolean {
  const { holidays } = policy

  if (holidays === undefined) {
    return () => false
  }

  const years = new Map<number, ReadonlySet<TradingDay>>()

  return (day) => {
    const year = yearOf(day)
    let closed = years.get(year)

    if (closed === undefined) {
      if (years.size >= MAXIMUM_CACHED_YEARS) {
        years.clear()
      }

      closed = new Set(holidays(year, isWeekend))
      years.set(year, closed)
    }

    return closed.has(day)
  }
}
