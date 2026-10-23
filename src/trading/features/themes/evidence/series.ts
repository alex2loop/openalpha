import type { TradingDay } from '@/trading/kernel/instrument'
import { MS_PER_DAY } from '@/core/utils/time'
import { utcDayOf } from '@/trading/sources/rows/normalization'

const QUARTER_MONTHS = 3
const BILLION = 1_000_000_000
const YEAR_MONTHS = 12
const FIGURE_DECIMALS = 2
const CHANGE_DECIMALS = 1
const PERCENT = 100
/** A feed that keeps exactly a year of sessions starts a day or two after the year-ago date; its
 *  first point still stands for that date, and every point prints its own day. */
const LOOKBACK_GRACE_DAYS = 7

interface DatedValue {
  readonly day: string
  readonly value: number
}

interface Lookbacks {
  readonly latest: DatedValue
  readonly quarterAgo?: DatedValue
  readonly yearAgo?: DatedValue
}

function pointAt(points: readonly DatedValue[], day: string): DatedValue | undefined {
  const graceEnd = toDayAfter(day, LOOKBACK_GRACE_DAYS)

  return (
    points.findLast((point) => point.day <= day) ?? points.find((point) => point.day <= graceEnd)
  )
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/** The same day `months` calendar months later, or earlier when negative; a month end maps to
 *  that month's end, so 31 March reaches back to 31 December, never to 30 November. */
export function shiftMonths(day: string, months: number): TradingDay {
  const at = new Date(`${day}T00:00:00Z`)
  const year = at.getUTCFullYear()
  const monthIndex = at.getUTCMonth() + months
  const date = at.getUTCDate()
  const targetLast = lastDayOfMonth(year, monthIndex)
  const isMonthEnd = date === lastDayOfMonth(year, at.getUTCMonth())

  return utcDayOf(Date.UTC(year, monthIndex, isMonthEnd ? targetLast : Math.min(date, targetLast)))
}

export function toDayBefore(day: string, days: number): TradingDay {
  return toDayAfter(day, -days)
}

function toDayAfter(day: string, days: number): TradingDay {
  return utcDayOf(Date.parse(`${day}T00:00:00Z`) + days * MS_PER_DAY)
}

/** Points oldest first, so a monthly, quarterly and daily series compare alike. */
export function toLookbacks(points: readonly DatedValue[]): Lookbacks | undefined {
  const latest = points.at(-1)

  if (latest === undefined) {
    return undefined
  }

  const quarterAgo = pointAt(points, shiftMonths(latest.day, -QUARTER_MONTHS))
  const yearAgo = pointAt(points, shiftMonths(latest.day, -YEAR_MONTHS))

  return {
    latest,
    ...(quarterAgo === undefined ? {} : { quarterAgo }),
    ...(yearAgo === undefined ? {} : { yearAgo }),
  }
}

export function formatFigure(value: number): string {
  return String(Number(value.toFixed(FIGURE_DECIMALS)))
}

export function formatChange(from: number, to: number): string {
  const percent = ((to - from) / from) * PERCENT

  return `${percent >= 0 ? '+' : ''}${percent.toFixed(CHANGE_DECIMALS)}%`
}

/** A change, signed. */
export function formatShare(fraction: number): string {
  return `${fraction >= 0 ? '+' : ''}${formatLevel(fraction)}`
}

/** A level such as a margin or a return on capital, unsigned so it never reads as a change. */
export function formatLevel(fraction: number): string {
  return `${(fraction * PERCENT).toFixed(CHANGE_DECIMALS)}%`
}

/** Where `value` stands in `history`: the share of readings at or below it, 0-100. */
export function toPercentRank(value: number, history: readonly number[]): number {
  return Math.round((PERCENT * history.filter((entry) => entry <= value).length) / history.length)
}

/** Dong in billions, the unit VN statements are read in. */
export function formatBillions(value: number): string {
  return `${Math.round(value / BILLION)} bn VND`
}
