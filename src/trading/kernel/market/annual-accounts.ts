import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { SourceId } from '@/trading/kernel/source/source-id'

/** The Beneish ratios a tripped manipulation read names, in print order. Only the ratios that push
 *  the score up are named: a rise in the other two lowers it. */
export const ACCOUNTS_WARNING_SIGNS = Object.freeze([
  'receivables',
  'margin',
  'asset-quality',
  'sales-growth',
  'depreciation',
  'accruals',
] as const)
export type AccountsWarningSign = (typeof ACCOUNTS_WARNING_SIGNS)[number]

/** A final year's figures, in the order a table prints them. */
export const ACCOUNTS_YEAR_FIELDS = Object.freeze([
  'netRevenue',
  'grossMargin',
  'coreOperatingProfit',
  'netProfitToParent',
  'operatingCashFlow',
  'capitalExpenditure',
  'freeCashFlow',
  'cashDividendsPaid',
  'shareIssueProceeds',
  'sharesOutstanding',
  'netDebt',
  'netDebtToEbitda',
  'interestCover',
  'returnOnInvestedCapital',
  'customerAdvances',
  'netInterestToAssets',
  'costToIncome',
  'capitalAdequacy',
] as const)
export type AccountsYearField = (typeof ACCOUNTS_YEAR_FIELDS)[number]

export const ACCOUNTS_TREND_FIELDS = Object.freeze([
  'revenueGrowth',
  'profitGrowth',
  'averageProfit',
  'cashConversion',
] as const)
export type AccountsTrendField = (typeof ACCOUNTS_TREND_FIELDS)[number]

export const ACCOUNTS_QUARTER_ROWS = 5

/** One quarter's figures, in the order a row prints them: the corporate ones, then a bank's. */
export const ACCOUNTS_QUARTER_FIELDS = Object.freeze([
  'netRevenue',
  'grossMargin',
  'coreOperatingProfit',
  'netProfitToParent',
  'operatingCashFlow',
  'customerAdvances',
  'nonCoreShare',
  'netInterestIncome',
  'operatingIncome',
  'costToIncome',
  'provisionExpense',
  'preTaxProfit',
] as const)
export type AccountsQuarterField = (typeof ACCOUNTS_QUARTER_FIELDS)[number]

/** One audited annual report's lines, in dong. Expenses are stored as positive amounts, so a
 *  reversal reads as a negative one. A line the provider did not publish is absent, and every score
 *  that needs it abstains rather than reading zero. */
export interface AccountLines {
  readonly totalAssets?: number
  readonly currentAssets?: number
  readonly currentLiabilities?: number
  readonly longTermDebt?: number
  readonly tradeReceivables?: number
  readonly netFixedAssets?: number
  readonly netRevenue?: number
  readonly grossProfit?: number
  readonly sellingExpenses?: number
  readonly adminExpenses?: number
  readonly netProfitToParent?: number
  readonly operatingCashFlow?: number
  readonly depreciation?: number
  readonly shareIssueProceeds?: number
  readonly cashAndEquivalents?: number
  readonly shortTermInvestments?: number
  readonly inventories?: number
  readonly shortTermDebt?: number
  readonly customerAdvances?: number
  readonly longTermCustomerAdvances?: number
  /** Minority interests included, as the consolidated statement carries it. */
  readonly totalEquity?: number
  readonly minorityInterests?: number
  /** Charter capital in common shares, which over the par value is the share count. */
  readonly commonShareCapital?: number
  readonly interestExpense?: number
  readonly preTaxProfit?: number
  readonly incomeTax?: number
  readonly capitalExpenditure?: number
  readonly shareRepurchases?: number
  /** Cash only: a stock dividend moves no cash and never appears here. */
  readonly cashDividendsPaid?: number
  /** Bank lines, published under the provider's bank codes; absent for every other company. */
  readonly customerLoans?: number
  readonly loanLossReserve?: number
  readonly customerDeposits?: number
  readonly currentDeposits?: number
  readonly watchListLoans?: number
  readonly substandardLoans?: number
  readonly doubtfulLoans?: number
  readonly lossLoans?: number
  readonly netInterestIncome?: number
  readonly operatingIncome?: number
  readonly operatingExpenses?: number
  /** A fraction, the one line not in dong. */
  readonly capitalAdequacy?: number
}

export interface AnnualAccounts {
  readonly instrument: InstrumentRef
  readonly fiscalYear: number
  /** The latest of the three statements' publication days. The provider updates a year in place
   *  and serves only its newest version, so a restatement carries its own later day. */
  readonly publishedOn: TradingDay
  readonly lines: AccountLines
  readonly sourceId: SourceId
  readonly fetchedAt: number
}

/** One final fiscal year read off its filed lines. A figure the lines cannot support is absent. */
export interface AccountsYear extends Readonly<Partial<Record<AccountsYearField, number>>> {
  readonly fiscalYear: number
  readonly publishedOn: TradingDay
}

export interface AccountsTrend extends Readonly<Partial<Record<AccountsTrendField, number>>> {
  /** Years from the base report to the newest, which the growth rates compound over. */
  readonly spanYears: number
}

/** A quarter's figure against the same quarter a year earlier. A fraction names its year-earlier
 *  value, never a percent of a percent; a profit that changed sign names the turn. */
export type AccountsQuarterComparison =
  | { readonly kind: 'growth'; readonly value: number }
  | { readonly kind: 'year-earlier'; readonly value: number }
  | { readonly kind: 'turned-profit' }
  | { readonly kind: 'turned-loss' }

export interface AccountsQuarter {
  readonly fiscalYear: number
  readonly quarter: FiscalQuarter
  readonly publishedOn: TradingDay
  readonly figures: Readonly<Partial<Record<AccountsQuarterField, number>>>
  readonly comparisons: Readonly<Partial<Record<AccountsQuarterField, AccountsQuarterComparison>>>
}

export interface AccountsHistory {
  readonly instrument: InstrumentRef
  /** Oldest first, and only the newest unbroken run of final years. */
  readonly years: readonly AccountsYear[]
  /** Only when the quarters run past the newest audited year. */
  readonly trailing?: TrailingAccounts
  /** The newest quarters published by the as-of day, newest first; empty when none is filed. */
  readonly quarters: readonly AccountsQuarter[]
  readonly trend?: AccountsTrend
  readonly caveats: readonly Caveat[]
  readonly sourceId: SourceId
  readonly fetchedAt: number
}

export type FiscalQuarter = 1 | 2 | 3 | 4

/** One quarter's own filing: three months of flows and the balance sheet at the quarter's close.
 *  Unaudited; the provider stamps Q4 with the audited year's date. */
export interface QuarterlyAccounts extends AnnualAccounts {
  readonly quarter: FiscalQuarter
}

/** Everything one read of a name's statements files. */
export interface FiledAccounts {
  readonly annual: readonly AnnualAccounts[]
  readonly quarters: readonly QuarterlyAccounts[]
}

/** The four newest quarters read as one year: flows summed, the balance sheet as of the last. */
export interface TrailingAccounts extends Readonly<Partial<Record<AccountsYearField, number>>> {
  readonly fiscalYear: number
  readonly quarter: FiscalQuarter
  readonly publishedOn: TradingDay
}

/** The adapter stores a bank's loan book only from a bank's payload, and that payload zero-fills
 *  every corporate line, so this is the one test a derivation branches on, never a zero. */
export function isBankLines(lines: AccountLines): boolean {
  return lines.customerLoans !== undefined
}
