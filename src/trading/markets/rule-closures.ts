import type { CalendarPolicy } from '@/trading/kernel/config'
import type { TradingDay } from '@/trading/kernel/instrument'
import { yearOf } from '@/trading/sources/rows/normalization'

const MAXIMUM_CACHED_YEARS = 32

/** Whether the policy's own rules close a day. */
export function createRuleClosures(
  policy: CalendarPolicy,
  isWeekend: (day: TradingDay) => boolean
): (day: TradingDay) => boolean {
  const { holidays } = policy

  return holidays === undefined
    ? () => false
    : createYearlyDays((year) => holidays(year, isWeekend))
}

/** Whether the policy's own rules end a day's session early. */
export function createRuleEarlyCloses(policy: CalendarPolicy): (day: TradingDay) => boolean {
  const { earlyCloses } = policy

  return earlyCloses === undefined ? () => false : createYearlyDays(earlyCloses.days)
}

/** A year's days are worked out once; the years asked about are few, and the cap keeps a walk over
 *  a malformed range from growing the map without end. */
function createYearlyDays(
  daysOf: (year: number) => readonly TradingDay[]
): (day: TradingDay) => boolean {
  const years = new Map<number, ReadonlySet<TradingDay>>()

  return (day) => {
    const year = yearOf(day)
    let days = years.get(year)

    if (days === undefined) {
      if (years.size >= MAXIMUM_CACHED_YEARS) {
        years.clear()
      }

      days = new Set(daysOf(year))
      years.set(year, days)
    }

    return days.has(day)
  }
}
