import type { TradingDay } from '@/trading/kernel/instrument'
import type { IndexReviewKind } from '@/trading/kernel/market/market-data'
import type { TradingCalendar } from '@/trading/markets/types'
import { tradingDay } from '@/trading/kernel/instrument'
import { FTSE_REVIEW_MONTHS, HOSE_REVIEW_MONTHS } from '@/trading/markets/equity-vn/policy'

export interface IndexReviewSession {
  readonly kind: IndexReviewKind
  /** The session the rebalance trades on: passive flow lands at this close. */
  readonly day: TradingDay
}

export type IndexReviewProximity = 'session' | 'eve'

const DAY_LENGTH = 10
const FRIDAY = 5
const MONDAY = 1
const THIRD_WEEK_OFFSET = 14
/** This year and next: a December review is next year's business from a late-December read. */
const CANDIDATE_YEARS = 2

/** The next rebalance session on or after `asOf`. A date that lands on a holiday moves to the
 *  previous trading day, because the exchange trades the rebalance on the last session before the
 *  index changes. */
export function nextIndexReview(
  asOf: TradingDay,
  calendar: TradingCalendar
): IndexReviewSession | undefined {
  return candidates(asOf, calendar)
    .filter((session) => session.day >= asOf)
    .toSorted((left, right) => left.day.localeCompare(right.day))[0]
}

/** `session` on the rebalance day itself, `eve` on the trading day before, otherwise nothing. */
export function indexReviewProximity(
  asOf: TradingDay,
  calendar: TradingCalendar
): IndexReviewProximity | undefined {
  const next = nextIndexReview(asOf, calendar)

  if (next === undefined) {
    return undefined
  }

  if (next.day === asOf) {
    return 'session'
  }

  return calendar.addTradingDays(asOf, 1) === next.day ? 'eve' : undefined
}

function candidates(asOf: TradingDay, calendar: TradingCalendar): readonly IndexReviewSession[] {
  const startYear = Number(asOf.slice(0, 4))

  if (!Number.isInteger(startYear)) {
    return []
  }

  return Array.from({ length: CANDIDATE_YEARS }, (_, offset) => startYear + offset).flatMap(
    (year) => [
      ...FTSE_REVIEW_MONTHS.map((month) => ({
        kind: 'ftse-geis' as const,
        day: lastSessionOnOrBefore(
          nthWeekday({ year, month, weekday: FRIDAY, offsetDays: THIRD_WEEK_OFFSET }),
          calendar
        ),
      })),
      ...HOSE_REVIEW_MONTHS.map((month) => ({
        kind: 'hose' as const,
        day: hoseRebalanceDay(nthWeekday({ year, month, weekday: MONDAY }), calendar),
      })),
    ]
  )
}

interface WeekdaySpec {
  readonly year: number
  readonly month: number
  readonly weekday: number
  readonly offsetDays?: number
}

/** The first `weekday` of the month, shifted forward by `offsetDays` (14 for the third one). */
function nthWeekday(spec: WeekdaySpec): TradingDay {
  const first = new Date(Date.UTC(spec.year, spec.month - 1, 1))
  const shift = (spec.weekday - first.getUTCDay() + 7) % 7
  const day = new Date(Date.UTC(spec.year, spec.month - 1, 1 + shift + (spec.offsetDays ?? 0)))

  return tradingDay(day.toISOString().slice(0, DAY_LENGTH))
}

function lastSessionOnOrBefore(day: TradingDay, calendar: TradingCalendar): TradingDay {
  return calendar.isTradingDay(day) ? day : calendar.addTradingDays(day, -1)
}

function hoseRebalanceDay(monday: TradingDay, calendar: TradingCalendar): TradingDay {
  if (!calendar.isTradingDay(monday)) {
    return lastSessionOnOrBefore(monday, calendar)
  }

  return calendar.addTradingDays(monday, -1)
}
