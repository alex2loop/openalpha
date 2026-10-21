import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type {
  AccountLines,
  AccountsHistory,
  AccountsTrend,
  AccountsYear,
  AnnualAccounts,
  QuarterlyAccounts,
  TrailingAccounts,
} from '@/trading/kernel/market/annual-accounts'
import type { TrendWindow } from '@/trading/markets/equity-vn/accounts/flags'
import { definedOnly } from '@/core/utils/collections'
import { isBankLines } from '@/trading/kernel/market/annual-accounts'
import { accountsFlags } from '@/trading/markets/equity-vn/accounts/flags'
import {
  averageOf,
  coreOperatingProfitOf,
  differenceOf,
  ratioOf,
  sumOf,
  totalOf,
} from '@/trading/markets/equity-vn/accounts/lines'
import { quarterGapCaveats } from '@/trading/markets/equity-vn/accounts/quarter-gaps'
import { toAccountsQuarters } from '@/trading/markets/equity-vn/accounts/quarters'
import { finalFiscalYear } from '@/trading/markets/equity-vn/accounts/score'
import { trailingLinesOf } from '@/trading/markets/equity-vn/accounts/trailing'
import { VN_ACCOUNTS_POLICY } from '@/trading/markets/equity-vn/factor-policy'
import { VN_SHARE_PAR_VND } from '@/trading/markets/equity-vn/policy'

type YearFigures = Omit<AccountsYear, 'fiscalYear' | 'publishedOn'>

interface HistoryInput {
  readonly instrument: InstrumentRef
  readonly reports: readonly AnnualAccounts[]
  readonly quarters: readonly QuarterlyAccounts[]
  readonly asOf: TradingDay
  /** A developer's cash swings with handovers, so the cash-timing flags stay silent for it. */
  readonly readingOnly: boolean
}

export function toAccountsHistory(input: HistoryInput): AccountsHistory | undefined {
  const reports = newestRun(finalYears(input.reports, input.asOf))
  const newest = reports.at(-1)

  if (newest === undefined) {
    return undefined
  }

  const window = trendWindowOf(reports)
  const trend = window === undefined ? undefined : toAccountsTrend(window)

  const years = reports.map((report, index) => toAccountsYear(report, reports[index - 1]))
  const trailing = trailingOf(input.quarters, newest, input.asOf)

  return {
    instrument: input.instrument,
    years,
    ...(trailing === undefined ? {} : { trailing }),
    quarters: toAccountsQuarters(input.quarters, input.asOf),
    ...(trend === undefined ? {} : { trend }),
    caveats: [
      ...accountsFlags({
        reports,
        years,
        ...(window === undefined ? {} : { window }),
        ...(trend === undefined ? {} : { trend }),
        readingOnly: input.readingOnly,
      }),
      ...quarterGapCaveats(input.quarters, input.asOf),
    ],
    sourceId: newest.sourceId,
    fetchedAt: newest.fetchedAt,
  }
}

/** The point-in-time rule the score reads: a year counts once its audit window has closed and it
 *  was published by `asOf`. */
function finalYears(
  reports: readonly AnnualAccounts[],
  asOf: TradingDay
): readonly AnnualAccounts[] {
  const finalYear = finalFiscalYear(asOf)

  return reports
    .filter((report) => report.fiscalYear <= finalYear && report.publishedOn <= asOf)
    .toSorted((left, right) => left.fiscalYear - right.fiscalYear)
}

/** A year the provider filed without all three statements is a hole, and a rate compounded across
 *  it measures nothing, so only the newest unbroken run is read. */
function newestRun(reports: readonly AnnualAccounts[]): readonly AnnualAccounts[] {
  let start = 0

  for (const [index, report] of reports.entries()) {
    const previous = reports[index - 1]

    if (previous !== undefined && report.fiscalYear !== previous.fiscalYear + 1) {
      start = index
    }
  }

  return reports.slice(start)
}

function trendWindowOf(reports: readonly AnnualAccounts[]): TrendWindow | undefined {
  const [base, ...flows] = reports.slice(-(VN_ACCOUNTS_POLICY.trendYears + 1))
  const newest = flows.at(-1)

  if (base === undefined || newest === undefined || flows.length < VN_ACCOUNTS_POLICY.trendYears) {
    return undefined
  }

  return { base, newest, flows }
}

/** Growth compounds from the base report to the newest; flows sum over the years after the base,
 *  so each year counts once. A bank's revenue and cash lines are zero-filled and read nothing. */
function toAccountsTrend(window: TrendWindow): AccountsTrend {
  const { base, newest } = window
  const spanYears = newest.fiscalYear - base.fiscalYear
  const profitGrowth = compoundGrowthOf(
    newest.lines.netProfitToParent,
    base.lines.netProfitToParent,
    spanYears
  )
  const flows = window.flows.map((report) => report.lines)
  const averageProfit = ratioOf(totalOf(flows, 'netProfitToParent'), flows.length)

  if (isBankLines(newest.lines)) {
    return { spanYears, ...definedOnly({ profitGrowth, averageProfit }) }
  }

  return {
    spanYears,
    ...definedOnly({
      revenueGrowth: compoundGrowthOf(newest.lines.netRevenue, base.lines.netRevenue, spanYears),
      profitGrowth,
      averageProfit,
      cashConversion: ratioOf(
        totalOf(flows, 'operatingCashFlow'),
        totalOf(flows, 'netProfitToParent')
      ),
    }),
  }
}

/** A loss at either end has no rate to compound. */
function compoundGrowthOf(
  now: number | undefined,
  base: number | undefined,
  spanYears: number
): number | undefined {
  const multiple = ratioOf(now, base)

  return multiple === undefined || multiple <= 0 ? undefined : multiple ** (1 / spanYears) - 1
}

function toAccountsYear(report: AnnualAccounts, prior: AnnualAccounts | undefined): AccountsYear {
  return {
    fiscalYear: report.fiscalYear,
    publishedOn: report.publishedOn,
    ...figuresOf(report.lines, prior?.lines),
  }
}

/** Only past the newest audited year: a window ending inside it, or on its Q4, restates the audit
 *  with unaudited numbers. ROIC and NII over assets need an opening balance and read nothing here. */
function trailingOf(
  quarters: readonly QuarterlyAccounts[],
  newest: AnnualAccounts | undefined,
  asOf: TradingDay
): TrailingAccounts | undefined {
  const window = trailingLinesOf(quarters, asOf)

  if (window === undefined || (newest !== undefined && window.fiscalYear <= newest.fiscalYear)) {
    return undefined
  }

  return {
    fiscalYear: window.fiscalYear,
    quarter: window.quarter,
    publishedOn: window.publishedOn,
    ...figuresOf(window.lines, undefined),
  }
}

function figuresOf(lines: AccountLines, prior: AccountLines | undefined): YearFigures {
  return isBankLines(lines) ? bankFigures(lines, prior) : corporateFigures(lines, prior)
}

/** Core operating profit is gross profit less selling and admin. The filing's own operating profit
 *  line already nets financial income and interest, so it can neither sit over invested capital nor
 *  cover interest. */
function corporateFigures(lines: AccountLines, prior: AccountLines | undefined): YearFigures {
  const coreOperatingProfit = coreOperatingProfitOf(lines)
  const netDebt = netDebtOf(lines)

  return definedOnly({
    netRevenue: lines.netRevenue,
    grossMargin: ratioOf(lines.grossProfit, lines.netRevenue),
    coreOperatingProfit,
    netProfitToParent: lines.netProfitToParent,
    operatingCashFlow: lines.operatingCashFlow,
    capitalExpenditure: lines.capitalExpenditure,
    freeCashFlow: differenceOf(lines.operatingCashFlow, lines.capitalExpenditure),
    cashDividendsPaid: lines.cashDividendsPaid,
    shareIssueProceeds: lines.shareIssueProceeds,
    sharesOutstanding: sharesOf(lines),
    netDebt,
    netDebtToEbitda: ratioOf(netDebt, sumOf([coreOperatingProfit, lines.depreciation])),
    interestCover: ratioOf(coreOperatingProfit, lines.interestExpense),
    returnOnInvestedCapital: returnOnInvestedCapitalOf(lines, prior),
    customerAdvances: sumOf([lines.customerAdvances, lines.longTermCustomerAdvances]),
  })
}

/** Net interest income is read over average total assets: the provider zero-fills its
 *  earning-assets line, so a margin on earning assets cannot be built from it. */
function bankFigures(lines: AccountLines, prior: AccountLines | undefined): YearFigures {
  return definedOnly({
    netProfitToParent: lines.netProfitToParent,
    netInterestToAssets: ratioOf(
      lines.netInterestIncome,
      averageOf(lines.totalAssets, prior?.totalAssets)
    ),
    costToIncome: ratioOf(lines.operatingExpenses, lines.operatingIncome),
    capitalAdequacy: positiveOf(lines.capitalAdequacy),
  })
}

function netDebtOf(lines: AccountLines): number | undefined {
  return differenceOf(
    sumOf([lines.shortTermDebt, lines.longTermDebt]),
    sumOf([lines.cashAndEquivalents, lines.shortTermInvestments])
  )
}

/** The provider fills a ratio the bank did not publish with zero, and no bank runs at none. */
function positiveOf(value: number | undefined): number | undefined {
  return value === undefined || value <= 0 ? undefined : value
}

function sharesOf(lines: AccountLines): number | undefined {
  const capital = lines.commonShareCapital

  return capital === undefined || capital <= 0 ? undefined : capital / VN_SHARE_PAR_VND
}

/** After tax, over the average of opening and closing capital: the first year of a run has no
 *  opening balance and reads nothing. */
function returnOnInvestedCapitalOf(
  lines: AccountLines,
  prior: AccountLines | undefined
): number | undefined {
  const profit = coreOperatingProfitOf(lines)
  const taxRate = taxRateOf(lines)
  const capital =
    prior === undefined ? undefined : averageOf(investedCapitalOf(prior), investedCapitalOf(lines))

  if (profit === undefined || taxRate === undefined) {
    return undefined
  }

  return ratioOf(profit * (1 - taxRate), capital)
}

function investedCapitalOf(lines: AccountLines): number | undefined {
  return sumOf([lines.totalEquity, netDebtOf(lines)])
}

/** A loss pays no tax, and a credit is not a negative rate. A profit whose tax line is missing has
 *  no rate at all, never a zero one. */
function taxRateOf(lines: AccountLines): number | undefined {
  const { preTaxProfit, incomeTax } = lines

  if (preTaxProfit === undefined) {
    return undefined
  }

  if (preTaxProfit <= 0) {
    return 0
  }

  const rate = ratioOf(incomeTax, preTaxProfit)

  return rate === undefined ? undefined : Math.min(Math.max(rate, 0), 1)
}
