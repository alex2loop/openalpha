import type { TradingDay } from '@/trading/kernel/instrument'
import type {
  AccountLines,
  FiscalQuarter,
  QuarterlyAccounts,
} from '@/trading/kernel/market/annual-accounts'
import { totalOf } from '@/trading/markets/equity-vn/accounts/lines'

const TRAILING_QUARTERS = 4
export const QUARTERS_PER_YEAR = 4

/** Lines that measure a period, which a trailing year sums. Every other line is a balance, read at
 *  the last quarter's close. */
const FLOW_LINES = Object.freeze([
  'netRevenue',
  'grossProfit',
  'sellingExpenses',
  'adminExpenses',
  'netProfitToParent',
  'operatingCashFlow',
  'depreciation',
  'shareIssueProceeds',
  'interestExpense',
  'preTaxProfit',
  'incomeTax',
  'capitalExpenditure',
  'shareRepurchases',
  'cashDividendsPaid',
  'netInterestIncome',
  'operatingIncome',
  'operatingExpenses',
] as const satisfies readonly (keyof AccountLines)[])
const FLOW_LINE_SET: ReadonlySet<keyof AccountLines> = new Set(FLOW_LINES)

interface TrailingLines {
  readonly fiscalYear: number
  readonly quarter: FiscalQuarter
  readonly publishedOn: TradingDay
  readonly lines: AccountLines
}

/** The four newest quarters published by `asOf`, unbroken. A flow any of them lacks is absent from
 *  the sum, never one quarter's figure read as a year's. */
export function trailingLinesOf(
  quarters: readonly QuarterlyAccounts[],
  asOf: TradingDay
): TrailingLines | undefined {
  const window = quarters
    .filter((report) => report.publishedOn <= asOf)
    .toSorted((left, right) => periodIndexOf(left) - periodIndexOf(right))
    .slice(-TRAILING_QUARTERS)
  const newest = window.at(-1)

  if (newest === undefined || window.length < TRAILING_QUARTERS || !isUnbroken(window)) {
    return undefined
  }

  return {
    fiscalYear: newest.fiscalYear,
    quarter: newest.quarter,
    publishedOn: latestPublishedOn(window, newest.publishedOn),
    lines: { ...balanceLinesOf(newest.lines), ...summedFlowsOf(window) },
  }
}

function summedFlowsOf(window: readonly QuarterlyAccounts[]): AccountLines {
  const flows = window.map((report) => report.lines)
  const summed: Partial<Record<keyof AccountLines, number>> = {}

  for (const line of FLOW_LINES) {
    const total = totalOf(flows, line)

    if (total !== undefined) {
      summed[line] = total
    }
  }

  return summed
}

/** A flow line is left out even when its sum is absent, so one quarter's figure never stands in for
 *  the year's. */
function balanceLinesOf(lines: AccountLines): AccountLines {
  const balance: Partial<Record<keyof AccountLines, number>> = {}

  // why-safe: `lines` is an `AccountLines`, so every key `Object.entries` yields is one of its fields.
  for (const [line, value] of Object.entries(lines) as [keyof AccountLines, number | undefined][]) {
    if (value !== undefined && !FLOW_LINE_SET.has(line)) {
      balance[line] = value
    }
  }

  return balance
}

function latestPublishedOn(window: readonly QuarterlyAccounts[], seed: TradingDay): TradingDay {
  return window.reduce(
    (latest, report) => (report.publishedOn > latest ? report.publishedOn : latest),
    seed
  )
}

function isUnbroken(window: readonly QuarterlyAccounts[]): boolean {
  return window.every((report, index) => {
    const previous = window[index - 1]

    return previous === undefined || periodIndexOf(report) === periodIndexOf(previous) + 1
  })
}

export function periodIndexOf(report: QuarterlyAccounts): number {
  return report.fiscalYear * QUARTERS_PER_YEAR + report.quarter
}
