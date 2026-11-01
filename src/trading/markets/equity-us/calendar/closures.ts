import type { TradingDay } from '@/trading/kernel/instrument'
import { tradingDay } from '@/trading/kernel/instrument'
import { shiftCalendarDay } from '@/trading/markets/calendar'

const SUNDAY = 0
const MONDAY = 1
const THURSDAY = 4
const SATURDAY = 6
const DAYS_PER_WEEK = 7
const JUNETEENTH_FIRST_YEAR = 2022
const GOOD_FRIDAY_BEFORE_EASTER = 2

/** Closures the exchanges announced outside their rules: national days of mourning. */
const ANNOUNCED_CLOSURES: readonly TradingDay[] = Object.freeze(['2025-01-09'].map(tradingDay))

/** NYSE Rule 7.2: the nine fixed and weekday-rule holidays plus Good Friday. A holiday on a Saturday
 *  closes the Friday before and one on a Sunday the Monday after, except New Year's Day on a
 *  Saturday, which closes nothing (the Friday is the last session of the old year). Early closes
 *  are sessions, so they are not here. */
export function usClosuresOf(year: number): readonly TradingDay[] {
  const newYear = newYearObserved(year)
  const days = [
    ...(newYear === undefined ? [] : [newYear]),
    nthWeekday(dayOf(year, 1, 1), MONDAY, 3),
    nthWeekday(dayOf(year, 2, 1), MONDAY, 3),
    shiftCalendarDay(easterSunday(year), -GOOD_FRIDAY_BEFORE_EASTER),
    lastWeekday(year, 5, MONDAY),
    ...(year >= JUNETEENTH_FIRST_YEAR ? [observed(dayOf(year, 6, 19))] : []),
    observed(dayOf(year, 7, 4)),
    nthWeekday(dayOf(year, 9, 1), MONDAY, 1),
    nthWeekday(dayOf(year, 11, 1), THURSDAY, 4),
    observed(dayOf(year, 12, 25)),
    ...ANNOUNCED_CLOSURES,
  ]

  return [...new Set(days)].filter((day) => day.startsWith(`${year}-`)).sort()
}

function newYearObserved(year: number): TradingDay | undefined {
  const day = dayOf(year, 1, 1)
  const weekday = weekdayOf(day)

  if (weekday === SATURDAY) {
    return undefined
  }

  return weekday === SUNDAY ? shiftCalendarDay(day, 1) : day
}

function observed(day: TradingDay): TradingDay {
  const weekday = weekdayOf(day)

  if (weekday === SATURDAY) {
    return shiftCalendarDay(day, -1)
  }

  return weekday === SUNDAY ? shiftCalendarDay(day, 1) : day
}

/** The `nth` given weekday of a month, counted from the month's first day. */
function nthWeekday(month: TradingDay, weekday: number, nth: number): TradingDay {
  const first = month
  const offset = (weekday - weekdayOf(first) + DAYS_PER_WEEK) % DAYS_PER_WEEK

  return shiftCalendarDay(first, offset + (nth - 1) * DAYS_PER_WEEK)
}

function lastWeekday(year: number, month: number, weekday: number): TradingDay {
  const last = shiftCalendarDay(dayOf(year, month + 1, 1), -1)
  const back = (weekdayOf(last) - weekday + DAYS_PER_WEEK) % DAYS_PER_WEEK

  return shiftCalendarDay(last, -back)
}

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
function easterSunday(year: number): TradingDay {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1

  return dayOf(year, month, day)
}

function dayOf(year: number, month: number, day: number): TradingDay {
  return tradingDay(new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10))
}

function weekdayOf(day: TradingDay): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay()
}
