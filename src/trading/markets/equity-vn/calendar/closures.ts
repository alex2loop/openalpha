import type { TradingDay } from '@/trading/kernel/instrument'
import { tradingDay } from '@/trading/kernel/instrument'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import { toSolarDay } from '@/trading/markets/equity-vn/calendar/lunar'

// The usual Tet break is the lunar new year's day and two days either side; a year the government
// sets differently is the operator's `holidays` / `open_days`.
const TET_DAYS_EACH_SIDE = 2
const HUNG_KINGS_LUNAR = { month: 3, day: 10 }
/** The Labor Code in force from 2021 gives National Day two days; before it, 2 September alone. */
const NATIONAL_DAY_SECOND_DAY_FIRST_YEAR = 2021
const VIETNAM_CULTURE_DAY_FIRST_YEAR = 2026

/** Days the government moved a working day onto a weekend for a longer break. They follow no rule,
 *  so each is written down when announced; the exchanges close with the civil service. */
const ANNOUNCED_SWAP_CLOSURES: readonly TradingDay[] = Object.freeze(
  ['2025-05-02', '2026-01-02', '2026-08-31'].map(tradingDay)
)

/** The weekdays HOSE and HNX are shut in a year: the paid public holidays of Labor Code art. 112
 *  (New Year, Tết, Giỗ Tổ, 30/4 and 1/5, National Day, and from 2026 Vietnam Culture Day), each
 *  one that lands on a weekend moved to the next weekday not already a closure, plus the announced
 *  swap days. From 2021 National Day takes a second adjacent day, the day before unless that is a
 *  weekend. */
export function vnClosuresOf(
  year: number,
  isWeekend: (day: TradingDay) => boolean
): readonly TradingDay[] {
  const statutory = statutoryDays(year, isWeekend)
  const closed = new Set<TradingDay>([...statutory, ...ANNOUNCED_SWAP_CLOSURES])

  for (const day of statutory.filter(isWeekend)) {
    closed.add(nextOpenWeekday(day, { closed, isWeekend }))
  }

  return [...closed].filter((day) => day.startsWith(`${year}-`) && !isWeekend(day)).sort()
}

function statutoryDays(year: number, isWeekend: (day: TradingDay) => boolean): TradingDay[] {
  const newYear = toSolarDay(year, 1, 1)
  const tet = Array.from({ length: 2 * TET_DAYS_EACH_SIDE + 1 }, (_, index) =>
    shiftCalendarDay(newYear, index - TET_DAYS_EACH_SIDE)
  )
  const days = [
    tradingDay(`${year}-01-01`),
    ...tet,
    toSolarDay(year, HUNG_KINGS_LUNAR.month, HUNG_KINGS_LUNAR.day),
    tradingDay(`${year}-04-30`),
    tradingDay(`${year}-05-01`),
    tradingDay(`${year}-09-02`),
  ]

  if (year >= NATIONAL_DAY_SECOND_DAY_FIRST_YEAR) {
    days.push(nationalDaySecond(year, isWeekend))
  }

  if (year >= VIETNAM_CULTURE_DAY_FIRST_YEAR) {
    days.push(tradingDay(`${year}-11-24`))
  }

  return days.sort()
}

function nationalDaySecond(year: number, isWeekend: (day: TradingDay) => boolean): TradingDay {
  const national = tradingDay(`${year}-09-02`)
  const before = shiftCalendarDay(national, -1)

  return isWeekend(before) ? shiftCalendarDay(national, 1) : before
}

interface WeekdayScan {
  readonly closed: ReadonlySet<TradingDay>
  readonly isWeekend: (day: TradingDay) => boolean
}

function nextOpenWeekday(day: TradingDay, scan: WeekdayScan): TradingDay {
  let next = shiftCalendarDay(day, 1)

  while (scan.isWeekend(next) || scan.closed.has(next)) {
    next = shiftCalendarDay(next, 1)
  }

  return next
}
