import type { TradingDay } from '@/trading/kernel/instrument'
import { ValidationError } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'

const MONTH_RE = /^(\d{4})-(\d{2})$/
const MONTHS_PER_YEAR = 12
const MONTHS_PER_QUARTER = 3
const ISO_MONTH_LENGTH = 7

interface MonthParts {
  readonly year: number
  readonly month: number
}

function parseMonth(month: string): MonthParts {
  const match = MONTH_RE.exec(month)

  if (match === null) {
    throw new ValidationError(`not a YYYY-MM month: ${month}`)
  }

  return { year: Number(match[1]), month: Number(match[2]) }
}

function toMonthText(parts: MonthParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`
}

export function toPreviousMonth(month: string): string {
  const parts = parseMonth(month)

  return parts.month === 1
    ? toMonthText({ year: parts.year - 1, month: MONTHS_PER_YEAR })
    : toMonthText({ year: parts.year, month: parts.month - 1 })
}

export function toNextMonth(month: string): string {
  const parts = parseMonth(month)

  return parts.month === MONTHS_PER_YEAR
    ? toMonthText({ year: parts.year + 1, month: 1 })
    : toMonthText({ year: parts.year, month: parts.month + 1 })
}

/** The day every figure for a month is stored under. */
export function toMonthEnd(month: string): TradingDay {
  const parts = parseMonth(month)
  const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate()

  return tradingDay(`${month}-${String(lastDay).padStart(2, '0')}`)
}

/** The `YYYY-MM` a `YYYY-MM-DD` day or ISO instant falls in. */
export function toMonthOf(isoDate: string): string {
  return isoDate.slice(0, ISO_MONTH_LENGTH)
}

/** UTC: a month boundary seven hours off never moves a statistics period. */
export function toMonth(atMs: number): string {
  return toMonthOf(new Date(atMs).toISOString())
}

/** `count` months ending at `latest`, newest first. */
export function recentMonths(latest: string, count: number): readonly string[] {
  const months: string[] = []
  let month = latest

  for (let index = 0; index < count; index += 1) {
    months.push(month)
    month = toPreviousMonth(month)
  }

  return months
}

export function isQuarterEndMonth(month: string): boolean {
  return parseMonth(month).month % MONTHS_PER_QUARTER === 0
}
