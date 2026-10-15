import type { Locale } from '@/core/types/locale'
import type { FactorMetricUnit } from '@/trading/kernel/factor-metric'
import type {
  AccountsHistory,
  AccountsTrendField,
  AccountsYear,
  AccountsYearField,
} from '@/trading/kernel/market/annual-accounts'
import type { UnitValue } from '@/trading/render/metric'
import type { QuotedIn } from '@/trading/render/money'
import { formatDay } from '@/i18n'
import {
  ACCOUNTS_TREND_FIELDS,
  ACCOUNTS_YEAR_FIELDS,
} from '@/trading/kernel/market/annual-accounts'
import { renderCaveatLines } from '@/trading/render/caveat'
import { renderDeclaredValue } from '@/trading/render/format'
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

/** One line per final fiscal year, oldest first, then the trend and the flags. A figure the filing
 *  could not support is left out of its line, never printed as zero. */
export function renderAccountsLines(
  locale: Locale,
  history: AccountsHistory,
  quote: Partial<QuotedIn>
): readonly string[] {
  return [
    ...history.years.map((year) => yearLine(locale, year, quote)),
    ...trailingLines(locale, history, quote),
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
