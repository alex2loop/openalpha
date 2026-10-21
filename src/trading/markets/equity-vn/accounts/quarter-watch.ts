import type { TradingDay } from '@/trading/kernel/instrument'
import type { FiscalQuarter } from '@/trading/kernel/market/annual-accounts'
import { tradingDay } from '@/trading/kernel/instrument'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import {
  QUARTER_WATCH_FROM_DAYS,
  QUARTER_WATCH_UNTIL_DAYS,
} from '@/trading/markets/equity-vn/policy'

const QUARTER_END: Readonly<Record<FiscalQuarter, string>> = Object.freeze({
  1: '03-31',
  2: '06-30',
  3: '09-30',
  4: '12-31',
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
