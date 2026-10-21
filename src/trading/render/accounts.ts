import type { Locale } from '@/core/types/locale'
import type { FactorMetricUnit } from '@/trading/kernel/factor-metric'
import type {
  AccountsHistory,
  AccountsQuarter,
  AccountsQuarterComparison,
  AccountsQuarterField,
  AccountsTrendField,
  AccountsYear,
  AccountsYearField,
} from '@/trading/kernel/market/annual-accounts'
import type { UnitValue } from '@/trading/render/metric'
import type { QuotedIn } from '@/trading/render/money'
import { formatDay } from '@/i18n'
import {
  ACCOUNTS_QUARTER_FIELDS,
  ACCOUNTS_TREND_FIELDS,
  ACCOUNTS_YEAR_FIELDS,
} from '@/trading/kernel/market/annual-accounts'
import { renderCaveatLines } from '@/trading/render/caveat'
import { formatSignedFraction, renderDeclaredValue } from '@/trading/render/format'
import { INLINE_SEPARATOR } from '@/trading/render/layout'
import { formatUnitValue } from '@/trading/render/metric'

const YEAR_UNITS = Object.freeze({
  netRevenue: 'currency',
  grossMargin: 'fraction',
  coreOperatingProfit: 'currency',
  netProfitToParent: 'currency',
  operatingCashFlow: 'currency',
  capitalExpenditure: 'currency',
  freeCashFlow: 'currency',
  cashDividendsPaid: 'currency',
  shareIssueProceeds: 'currency',
  sharesOutstanding: 'count',
  netDebt: 'currency',
  netDebtToEbitda: 'ratio',
  interestCover: 'multiple',
  returnOnInvestedCapital: 'fraction',
  customerAdvances: 'currency',
  netInterestToAssets: 'fraction',
  costToIncome: 'fraction',
  capitalAdequacy: 'fraction',
} as const satisfies Readonly<Record<AccountsYearField, FactorMetricUnit>>)

const QUARTER_UNITS = Object.freeze({
  netRevenue: 'currency',
  grossMargin: 'fraction',
  coreOperatingProfit: 'currency',
  netProfitToParent: 'currency',
  operatingCashFlow: 'currency',
  customerAdvances: 'currency',
  nonCoreShare: 'fraction',
  netInterestIncome: 'currency',
  operatingIncome: 'currency',
  costToIncome: 'fraction',
  provisionExpense: 'currency',
  preTaxProfit: 'currency',
} as const satisfies Readonly<Record<AccountsQuarterField, FactorMetricUnit>>)

const TREND_UNITS = Object.freeze({
  revenueGrowth: 'fraction',
  profitGrowth: 'fraction',
  averageProfit: 'currency',
  cashConversion: 'multiple',
} as const satisfies Readonly<Record<AccountsTrendField, FactorMetricUnit>>)

interface FactInput {
  readonly key: `trading.${string}`
  readonly reading: Partial<UnitValue> & Pick<UnitValue, 'unit'>
  readonly quote: Partial<QuotedIn>
}

/** One line per final fiscal year, oldest first, then the trailing year, the newest quarters newest
 *  first, the trend and the flags. A figure the filing could not support is left out of its line,
 *  never printed as zero. */
export function renderAccountsLines(
  locale: Locale,
  history: AccountsHistory,
  quote: Partial<QuotedIn>
): readonly string[] {
  return [
    ...history.years.map((year) => yearLine(locale, year, quote)),
    ...trailingLines(locale, history, quote),
    ...quarterLines(locale, history, quote),
    ...trendLines(locale, history, quote),
    ...renderCaveatLines(locale, history.caveats),
  ]
}

function yearLine(locale: Locale, year: AccountsYear, quote: Partial<QuotedIn>): string {
  const title = renderDeclaredValue(locale, 'trading.accounts-table.year', {
    year: String(year.fiscalYear),
    day: formatDay(locale, year.publishedOn),
  })

  return [title, ...figureFacts(locale, year, quote)].join(INLINE_SEPARATOR)
}

function trailingLines(
  locale: Locale,
  history: AccountsHistory,
  quote: Partial<QuotedIn>
): readonly string[] {
  const { trailing } = history

  if (trailing === undefined) {
    return []
  }

  const title = renderDeclaredValue(locale, 'trading.accounts-table.trailing', {
    quarter: String(trailing.quarter),
    year: String(trailing.fiscalYear),
    day: formatDay(locale, trailing.publishedOn),
  })

  return [[title, ...figureFacts(locale, trailing, quote)].join(INLINE_SEPARATOR)]
}

function quarterLines(
  locale: Locale,
  history: AccountsHistory,
  quote: Partial<QuotedIn>
): readonly string[] {
  return history.quarters.map((report) => {
    const facts = ACCOUNTS_QUARTER_FIELDS.flatMap((field) =>
      quarterFact(locale, { report, field, quote })
    )

    return [quarterTitle(locale, report), ...facts].join(INLINE_SEPARATOR)
  })
}

function quarterTitle(locale: Locale, report: AccountsQuarter): string {
  const title = filedTitle(locale, report)

  return report.cashFlowSourceId === undefined
    ? title
    : [title, renderDeclaredValue(locale, 'trading.accounts-table.cash-flow-derived')].join(
        INLINE_SEPARATOR
      )
}

/** Q4 carries no filed day: the provider stamps it with the audited year's date. */
function filedTitle(locale: Locale, report: AccountsQuarter): string {
  const year = String(report.fiscalYear)

  if (report.quarter === 4) {
    return renderDeclaredValue(locale, 'trading.accounts-table.quarter-q4', { year })
  }

  return renderDeclaredValue(locale, 'trading.accounts-table.quarter', {
    quarter: String(report.quarter),
    year,
    day: formatDay(locale, report.publishedOn),
  })
}

interface QuarterFactInput {
  readonly report: AccountsQuarter
  readonly field: AccountsQuarterField
  readonly quote: Partial<QuotedIn>
}

function quarterFact(locale: Locale, input: QuarterFactInput): readonly string[] {
  const { report, field, quote } = input
  const unit = QUARTER_UNITS[field]
  const [text] = fact(locale, {
    key: `trading.accounts-field.${field}`,
    reading: { unit, ...definedValue(report.figures[field]) },
    quote,
  })
  const comparison = report.comparisons[field]

  if (text === undefined) {
    return []
  }

  if (comparison === undefined) {
    return [text]
  }

  return [
    renderDeclaredValue(locale, 'trading.accounts-quarter.fact', {
      fact: text,
      comparison: comparisonText(locale, { comparison, unit, quote }),
    }),
  ]
}

interface ComparisonTextInput {
  readonly comparison: AccountsQuarterComparison
  readonly unit: FactorMetricUnit
  readonly quote: Partial<QuotedIn>
}

function comparisonText(locale: Locale, input: ComparisonTextInput): string {
  const { comparison } = input

  switch (comparison.kind) {
    case 'growth':
      return renderDeclaredValue(locale, 'trading.accounts-quarter.yoy', {
        change: formatSignedFraction(locale, comparison.value),
      })
    case 'year-earlier':
      return renderDeclaredValue(locale, 'trading.accounts-quarter.year-earlier', {
        value: formatUnitValue(locale, { unit: input.unit, value: comparison.value }, input.quote),
      })
    case 'turned-profit':
      return renderDeclaredValue(locale, 'trading.accounts-quarter.turned-profit')
    case 'turned-loss':
      return renderDeclaredValue(locale, 'trading.accounts-quarter.turned-loss')
    default: {
      const unreachable: never = comparison

      return unreachable
    }
  }
}

function figureFacts(
  locale: Locale,
  figures: Readonly<Partial<Record<AccountsYearField, number>>>,
  quote: Partial<QuotedIn>
): readonly string[] {
  return ACCOUNTS_YEAR_FIELDS.flatMap((field) =>
    fact(locale, {
      key: `trading.accounts-field.${field}`,
      reading: { unit: YEAR_UNITS[field], ...definedValue(figures[field]) },
      quote,
    })
  )
}

function trendLines(
  locale: Locale,
  history: AccountsHistory,
  quote: Partial<QuotedIn>
): readonly string[] {
  const { trend } = history

  if (trend === undefined) {
    return []
  }

  const facts = ACCOUNTS_TREND_FIELDS.flatMap((field) =>
    fact(locale, {
      key: `trading.accounts-trend.${field}`,
      reading: { unit: TREND_UNITS[field], ...definedValue(trend[field]) },
      quote,
    })
  )
  const title = renderDeclaredValue(locale, 'trading.accounts-table.trend', {
    years: String(trend.spanYears),
  })

  return facts.length === 0 ? [] : [[title, ...facts].join(INLINE_SEPARATOR)]
}

function fact(locale: Locale, input: FactInput): readonly string[] {
  const { value, unit } = input.reading

  return value === undefined
    ? []
    : [
        `${renderDeclaredValue(locale, input.key)} ${formatUnitValue(locale, { unit, value }, input.quote)}`,
      ]
}

function definedValue(value: number | undefined): { readonly value?: number } {
  return value === undefined ? {} : { value }
}
