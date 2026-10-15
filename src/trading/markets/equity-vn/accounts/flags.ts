import type { Caveat } from '@/trading/kernel/caveat'
import type {
  AccountsTrend,
  AccountsYear,
  AnnualAccounts,
} from '@/trading/kernel/market/annual-accounts'
import { isBankLines } from '@/trading/kernel/market/annual-accounts'
import { growthOf, ratioOf, sumOf, totalOf } from '@/trading/markets/equity-vn/accounts/lines'
import { VN_ACCOUNTS_POLICY } from '@/trading/markets/equity-vn/factor-policy'

/** The reports a trend is read over: the base year and the years after it, newest last. */
export interface TrendWindow {
  readonly base: AnnualAccounts
  readonly newest: AnnualAccounts
  readonly flows: readonly AnnualAccounts[]
}

interface FlagsInput {
  readonly reports: readonly AnnualAccounts[]
  readonly years: readonly AccountsYear[]
  readonly window?: TrendWindow
  readonly trend?: AccountsTrend
  readonly readingOnly: boolean
}

interface LastTwo {
  readonly prior: AnnualAccounts
  readonly newest: AnnualAccounts
}

/** Observations, never verdicts: none moves conviction, gates a buy or sells. A bank's corporate
 *  lines are zero-filled, so it raises only the layout flag. */
export function accountsFlags(input: FlagsInput): readonly Caveat[] {
  const newest = input.reports.at(-1)

  if (newest === undefined) {
    return []
  }

  const dropped = linesDroppedFlag(input.reports)
  const flags = isBankLines(newest.lines)
    ? [dropped]
    : [
        dropped,
        interestCoverFlag(input.years),
        equityRaisedFlag(input.window),
        ...(input.readingOnly ? [] : cashTimingFlags(input)),
      ]

  return flags.filter((flag): flag is Caveat => flag !== undefined)
}

/** The flags a developer's handover cycle drives, which a reading-only sector does not raise. */
function cashTimingFlags(input: FlagsInput): readonly (Caveat | undefined)[] {
  return [
    inventoryFlag(input.reports),
    cashConversionFlag(input.trend),
    freeCashFlag(input.window, input.years),
    dividendFlag(input.window, input.years),
  ]
}

/** A line the year before carried and the newest lacks is the provider's layout changing, which
 *  every figure needing it then abstains on. */
function linesDroppedFlag(reports: readonly AnnualAccounts[]): Caveat | undefined {
  const pair = lastTwo(reports)

  if (pair === undefined) {
    return undefined
  }

  const missingLines = Object.keys(pair.prior.lines).filter(
    (line) => !(line in pair.newest.lines)
  ).length

  return missingLines === 0
    ? undefined
    : {
        code: 'factor.accounts-lines-dropped',
        detail: { fiscalYear: String(pair.newest.fiscalYear), missingLines },
      }
}

function interestCoverFlag(years: readonly AccountsYear[]): Caveat | undefined {
  const recent = years.slice(-(VN_ACCOUNTS_POLICY.interestCoverFallingYears + 1))
  const covers = recent.flatMap((year) =>
    year.interestCover === undefined ? [] : [year.interestCover]
  )
  const newest = recent.at(-1)
  const cover = covers.at(-1)

  if (
    newest === undefined ||
    cover === undefined ||
    covers.length !== VN_ACCOUNTS_POLICY.interestCoverFallingYears + 1 ||
    cover >= VN_ACCOUNTS_POLICY.minimumInterestCover ||
    !isFalling(covers)
  ) {
    return undefined
  }

  return {
    code: 'factor.interest-cover-falling',
    detail: { fiscalYear: String(newest.fiscalYear), cover },
  }
}

function equityRaisedFlag(window: TrendWindow | undefined): Caveat | undefined {
  if (window === undefined) {
    return undefined
  }

  const raisedShare = ratioOf(
    totalOf(flowLinesOf(window), 'shareIssueProceeds'),
    window.base.lines.totalAssets
  )

  return raisedShare === undefined || raisedShare < VN_ACCOUNTS_POLICY.materialRaiseShare
    ? undefined
    : { code: 'factor.equity-raised', detail: { years: window.flows.length, raisedShare } }
}

function inventoryFlag(reports: readonly AnnualAccounts[]): Caveat | undefined {
  const pair = lastTwo(reports)
  const inventoryGrowth = growthOf(pair?.newest.lines.inventories, pair?.prior.lines.inventories)
  const salesGrowth = growthOf(pair?.newest.lines.netRevenue, pair?.prior.lines.netRevenue)

  if (
    pair === undefined ||
    inventoryGrowth === undefined ||
    salesGrowth === undefined ||
    inventoryGrowth - salesGrowth < VN_ACCOUNTS_POLICY.inventoryGrowthGap
  ) {
    return undefined
  }

  return {
    code: 'factor.inventory-outpacing-sales',
    detail: { fiscalYear: String(pair.newest.fiscalYear), inventoryGrowth, salesGrowth },
  }
}

function cashConversionFlag(trend: AccountsTrend | undefined): Caveat | undefined {
  const conversion = trend?.cashConversion

  if (
    trend === undefined ||
    conversion === undefined ||
    conversion >= VN_ACCOUNTS_POLICY.minimumCashConversion
  ) {
    return undefined
  }

  return { code: 'factor.cash-conversion-low', detail: { years: trend.spanYears, conversion } }
}

/** Capex against depreciation travels with it, because spending that builds capacity and a
 *  business that cannot fund itself both read negative here. */
function freeCashFlag(
  window: TrendWindow | undefined,
  years: readonly AccountsYear[]
): Caveat | undefined {
  if (window === undefined) {
    return undefined
  }

  const measured = windowYearsOf(window, years)
  const negativeYears = measured.filter(
    (year) => year.freeCashFlow !== undefined && year.freeCashFlow < 0
  ).length
  const lines = flowLinesOf(window)
  const capexToDepreciation = ratioOf(
    totalOf(lines, 'capitalExpenditure'),
    totalOf(lines, 'depreciation')
  )

  if (
    negativeYears < VN_ACCOUNTS_POLICY.negativeFreeCashYears ||
    capexToDepreciation === undefined
  ) {
    return undefined
  }

  return {
    code: 'factor.free-cash-negative',
    detail: { negativeYears, years: measured.length, capexToDepreciation },
  }
}

function dividendFlag(
  window: TrendWindow | undefined,
  years: readonly AccountsYear[]
): Caveat | undefined {
  if (window === undefined) {
    return undefined
  }

  const dividends = totalOf(flowLinesOf(window), 'cashDividendsPaid')
  const freeCash = sumOf(windowYearsOf(window, years).map((year) => year.freeCashFlow))

  if (
    dividends === undefined ||
    freeCash === undefined ||
    dividends <= 0 ||
    dividends <= freeCash ||
    !isMaterialPayout(dividends, totalOf(flowLinesOf(window), 'netProfitToParent'))
  ) {
    return undefined
  }

  return { code: 'factor.dividend-above-free-cash', detail: { years: window.flows.length } }
}

function lastTwo(reports: readonly AnnualAccounts[]): LastTwo | undefined {
  const [prior, newest] = reports.slice(-2)

  return prior === undefined || newest === undefined ? undefined : { prior, newest }
}

function flowLinesOf(window: TrendWindow): readonly AnnualAccounts['lines'][] {
  return window.flows.map((report) => report.lines)
}

function windowYearsOf(
  window: TrendWindow,
  years: readonly AccountsYear[]
): readonly AccountsYear[] {
  return years.slice(-window.flows.length)
}

/** A payout out of a loss is always material; a profit line the provider did not file is not. */
function isMaterialPayout(dividends: number, profit: number | undefined): boolean {
  if (profit === undefined) {
    return false
  }

  const payout = ratioOf(dividends, profit)

  return payout === undefined || payout >= VN_ACCOUNTS_POLICY.materialPayoutShare
}

function isFalling(values: readonly number[]): boolean {
  return values.slice(1).every((value, index) => {
    const before = values[index]

    return before !== undefined && value < before
  })
}
