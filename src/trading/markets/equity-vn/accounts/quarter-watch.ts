import type { TradingDay } from '@/trading/kernel/instrument'
import type { FiscalQuarter } from '@/trading/kernel/market/annual-accounts'
import { tradingDay } from '@/trading/kernel/instrument'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import { quarterlyReportDeadline } from '@/trading/markets/disclosure-calendar'
import {
  QUARTER_WATCH_FROM_DAYS,
  QUARTER_WATCH_UNTIL_DAYS,
} from '@/trading/markets/equity-vn/policy'

const QUARTERS: readonly FiscalQuarter[] = Object.freeze([1, 2, 3, 4])
const QUARTER_END: Readonly<Record<FiscalQuarter, string>> = Object.freeze({
  1: '03-31',
  2: '06-30',
  3: '09-30',
  4: '12-31',
})
const PREVIOUS_QUARTER: Readonly<Record<FiscalQuarter, FiscalQuarter>> = Object.freeze({
  1: 4,
  2: 1,
  3: 2,
  4: 3,
})

interface QuarterRef {
  readonly fiscalYear: number
  readonly quarter: FiscalQuarter
}

export function quarterEndDay(ref: QuarterRef): TradingDay {
  return tradingDay(`${ref.fiscalYear}-${QUARTER_END[ref.quarter]}`)
}

/** The quarter that last ended inside its filing window, or none once the window has closed. Read
 *  on the calendar year most VN issuers keep; a name on another fiscal year is only asked a few
 *  extra times. */
export function watchedQuarter(day: TradingDay): QuarterRef | undefined {
  // A day past the cutoff, so a quarter that ended on the cutoff itself counts as ended.
  const after = shiftCalendarDay(day, 1 - QUARTER_WATCH_FROM_DAYS)
  const year = Number(after.slice(0, 4))
  const ended = Math.ceil(Number(after.slice(5, 7)) / 3) - 1
  const watched: QuarterRef =
    ended === 0
      ? { fiscalYear: year - 1, quarter: 4 }
      : { fiscalYear: year, quarter: ended as FiscalQuarter }

  return day <= shiftCalendarDay(quarterEndDay(watched), QUARTER_WATCH_UNTIL_DAYS)
    ? watched
    : undefined
}

/** The latest quarter whose statutory filing deadline has passed by `day`. */
export function lastDueQuarter(day: TradingDay): QuarterRef {
  return dueFrom(containingQuarter(day), day)
}

function dueFrom(ref: QuarterRef, day: TradingDay): QuarterRef {
  if (quarterlyReportDeadline(quarterEndDay(ref)) < day) {
    return ref
  }

  return dueFrom(
    {
      fiscalYear: ref.quarter === 1 ? ref.fiscalYear - 1 : ref.fiscalYear,
      quarter: PREVIOUS_QUARTER[ref.quarter],
    },
    day
  )
}

function containingQuarter(day: TradingDay): QuarterRef {
  const month = Number(day.slice(5, 7))
  const quarter = QUARTERS.find((candidate) => Number(QUARTER_END[candidate].slice(0, 2)) >= month)

  return { fiscalYear: Number(day.slice(0, 4)), quarter: quarter ?? 4 }
}
