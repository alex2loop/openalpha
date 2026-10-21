import type { TradingDay } from '@/trading/kernel/instrument'
import type {
  AccountLines,
  AccountsQuarter,
  AccountsQuarterComparison,
  AccountsQuarterField,
  QuarterlyAccounts,
} from '@/trading/kernel/market/annual-accounts'
import { definedOnly } from '@/core/utils/collections'
import {
  ACCOUNTS_QUARTER_FIELDS,
  ACCOUNTS_QUARTER_ROWS,
  isBankLines,
} from '@/trading/kernel/market/annual-accounts'
import {
  coreOperatingProfitOf,
  differenceOf,
  growthOf,
  ratioOf,
  sumOf,
} from '@/trading/markets/equity-vn/accounts/lines'
import { periodIndexOf, QUARTERS_PER_YEAR } from '@/trading/markets/equity-vn/accounts/trailing'

const FRACTION_FIELDS: ReadonlySet<AccountsQuarterField> = new Set([
  'grossMargin',
  'costToIncome',
  'nonCoreShare',
])
const PROFIT_FIELDS: ReadonlySet<AccountsQuarterField> = new Set([
  'coreOperatingProfit',
  'netProfitToParent',
  'preTaxProfit',
])

type QuarterFigures = AccountsQuarter['figures']

/** The newest quarters published by `asOf`, newest first, each against the same quarter a year
 *  earlier from the same published set. A year-earlier quarter that is not filed leaves its figures
 *  with no comparison. */
export function toAccountsQuarters(
  quarters: readonly QuarterlyAccounts[],
  asOf: TradingDay
): readonly AccountsQuarter[] {
  const published = quarters.filter((report) => report.publishedOn <= asOf)
  const byPeriod = new Map(published.map((report) => [periodIndexOf(report), report]))

  return published
    .toSorted((left, right) => periodIndexOf(right) - periodIndexOf(left))
    .slice(0, ACCOUNTS_QUARTER_ROWS)
    .map((report) => {
      const before = byPeriod.get(periodIndexOf(report) - QUARTERS_PER_YEAR)

      return toAccountsQuarter(report, before)
    })
}

function toAccountsQuarter(
  report: QuarterlyAccounts,
  yearEarlier: QuarterlyAccounts | undefined
): AccountsQuarter {
  const figures = figuresOf(report.lines)
  const earlier = yearEarlier === undefined ? undefined : figuresOf(yearEarlier.lines)

  return {
    fiscalYear: report.fiscalYear,
    quarter: report.quarter,
    publishedOn: report.publishedOn,
    figures,
    comparisons: earlier === undefined ? {} : comparisonsOf(figures, earlier),
    ...(report.cashFlowSourceId === undefined ? {} : { cashFlowSourceId: report.cashFlowSourceId }),
  }
}

function comparisonsOf(
  figures: QuarterFigures,
  earlier: QuarterFigures
): AccountsQuarter['comparisons'] {
  const comparisons: Partial<Record<AccountsQuarterField, AccountsQuarterComparison>> = {}

  for (const field of ACCOUNTS_QUARTER_FIELDS) {
    const now = figures[field]
    const before = earlier[field]
    const comparison =
      now === undefined || before === undefined ? undefined : comparisonOf({ field, now, before })

    if (comparison !== undefined) {
      comparisons[field] = comparison
    }
  }

  return comparisons
}

interface ComparisonInput {
  readonly field: AccountsQuarterField
  readonly now: number
  readonly before: number
}

function comparisonOf(input: ComparisonInput): AccountsQuarterComparison | undefined {
  const { field, now, before } = input

  if (FRACTION_FIELDS.has(field)) {
    return { kind: 'year-earlier', value: before }
  }

  if (PROFIT_FIELDS.has(field) && before < 0 && now > 0) {
    return { kind: 'turned-profit' }
  }

  if (PROFIT_FIELDS.has(field) && before > 0 && now < 0) {
    return { kind: 'turned-loss' }
  }

  if (now <= 0 || before <= 0) {
    return undefined
  }

  const value = growthOf(now, before)

  return value === undefined ? undefined : { kind: 'growth', value }
}

function figuresOf(lines: AccountLines): QuarterFigures {
  return isBankLines(lines) ? bankFigures(lines) : corporateFigures(lines)
}

/** The provider zero-fills a bank's corporate lines, so a bank prints only its own. Credit
 *  provisions are what is left of operating income after expenses and before pre-tax profit. */
function bankFigures(lines: AccountLines): QuarterFigures {
  return definedOnly({
    netInterestIncome: lines.netInterestIncome,
    operatingIncome: lines.operatingIncome,
    costToIncome: ratioOf(lines.operatingExpenses, lines.operatingIncome),
    provisionExpense: differenceOf(
      differenceOf(lines.operatingIncome, lines.operatingExpenses),
      lines.preTaxProfit
    ),
    preTaxProfit: lines.preTaxProfit,
    netProfitToParent: lines.netProfitToParent,
  })
}

function corporateFigures(lines: AccountLines): QuarterFigures {
  const coreOperatingProfit = coreOperatingProfitOf(lines)

  return definedOnly({
    netRevenue: lines.netRevenue,
    grossMargin: ratioOf(lines.grossProfit, lines.netRevenue),
    coreOperatingProfit,
    netProfitToParent: lines.netProfitToParent,
    operatingCashFlow: lines.operatingCashFlow,
    customerAdvances: sumOf([lines.customerAdvances, lines.longTermCustomerAdvances]),
    nonCoreShare: nonCoreShareOf(lines.preTaxProfit, coreOperatingProfit),
  })
}

/** The part of a profitable quarter's pre-tax profit that the core business did not earn. */
function nonCoreShareOf(
  preTaxProfit: number | undefined,
  coreOperatingProfit: number | undefined
): number | undefined {
  const share = ratioOf(differenceOf(preTaxProfit, coreOperatingProfit), preTaxProfit)

  return share === undefined || share <= 0 ? undefined : share
}
