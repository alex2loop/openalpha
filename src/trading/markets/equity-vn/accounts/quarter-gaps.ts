import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { QuarterlyAccounts } from '@/trading/kernel/market/annual-accounts'
import { hasCashFlow, isBankLines } from '@/trading/kernel/market/annual-accounts'
import { quarterlyReportDeadline } from '@/trading/markets/disclosure-calendar'
import { lastDueQuarter, quarterEndDay } from '@/trading/markets/equity-vn/accounts/quarter-watch'
import { periodIndexOf } from '@/trading/markets/equity-vn/accounts/trailing'

/** The codes that reach the report as well as the prompt; the other accounts flags stay in the
 *  prompt. */
export const QUARTER_GAP_CODES: ReadonlySet<CaveatCode> = new Set<CaveatCode>([
  'factor.accounts-quarter-partial',
  'factor.accounts-quarter-late',
])

/** What the newest published quarter is missing: its cash flow, or the quarter after it, whose
 *  deadline has passed. Two or more quarters behind is `market.report-overdue`'s to say. */
export function quarterGapCaveats(
  quarters: readonly QuarterlyAccounts[],
  asOf: TradingDay
): readonly Caveat[] {
  const newest = quarters
    .filter((report) => report.publishedOn <= asOf)
    .toSorted((left, right) => periodIndexOf(right) - periodIndexOf(left))[0]

  if (newest === undefined) {
    return []
  }

  return [...partialCaveat(newest), ...lateCaveat(newest, asOf)]
}

/** A bank files its cash flow under other codes, so it never reads as missing one. */
function partialCaveat(newest: QuarterlyAccounts): readonly Caveat[] {
  if (hasCashFlow(newest.lines) || isBankLines(newest.lines)) {
    return []
  }

  return [
    {
      code: 'factor.accounts-quarter-partial',
      detail: {
        quarter: String(newest.quarter),
        year: String(newest.fiscalYear),
        day: newest.publishedOn,
      },
    },
  ]
}

function lateCaveat(newest: QuarterlyAccounts, asOf: TradingDay): readonly Caveat[] {
  const due = lastDueQuarter(asOf)

  if (periodIndexOf(newest) !== periodIndexOf(due) - 1) {
    return []
  }

  return [
    {
      code: 'factor.accounts-quarter-late',
      detail: {
        quarter: String(due.quarter),
        year: String(due.fiscalYear),
        day: quarterlyReportDeadline(quarterEndDay(due)),
      },
    },
  ]
}
