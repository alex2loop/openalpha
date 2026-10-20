import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { AnnualAccounts } from '@/trading/kernel/market/annual-accounts'
import { rankWithin } from '@/trading/markets/factor-scoring'

/** What a name's newest filed year says against what the market pays for it. */
interface UsFundamentals {
  /** Net income over capitalisation: what a dollar of the company yields. */
  readonly earningsYield?: number
  /** Shareholders' equity over capitalisation. */
  readonly bookToMarket?: number
  /** Gross profit over total assets: how much the assets earn before overheads. */
  readonly grossProfitability?: number
}

/** The ranks the factors read, each against the board: absent where the name has no reading to rank. */
export interface UsFundamentalRanks {
  readonly value?: number
  readonly quality?: number
}

/** The newest fiscal year published by `asOf`: a report counts from the day it was filed, never
 *  from the day its year ended. */
export function newestReport(
  reports: readonly AnnualAccounts[] | undefined,
  asOf: TradingDay
): AnnualAccounts | undefined {
  return (reports ?? [])
    .filter((report) => report.publishedOn <= asOf)
    .toSorted((left, right) => right.fiscalYear - left.fiscalYear)[0]
}

/** Banks and insurers report no gross profit, so their quality is absent, not zero. */
export function usFundamentalsOf(
  report: AnnualAccounts | undefined,
  marketCap: number
): UsFundamentals {
  const { netProfitToParent, totalEquity, grossProfit, totalAssets } = report?.lines ?? {}

  return {
    ...(netProfitToParent === undefined ? {} : { earningsYield: netProfitToParent / marketCap }),
    ...(totalEquity === undefined ? {} : { bookToMarket: totalEquity / marketCap }),
    ...(grossProfit === undefined || totalAssets === undefined || totalAssets <= 0
      ? {}
      : { grossProfitability: grossProfit / totalAssets }),
  }
}

/** Value is the mean of the earnings-yield and book-to-market ranks that exist; quality is the
 *  gross-profitability rank. A name with neither reading is simply absent from the map. */
export function rankFundamentals(
  entries: ReadonlyMap<Ticker, UsFundamentals>
): ReadonlyMap<Ticker, UsFundamentalRanks> {
  const all = [...entries.values()]
  const populations = {
    earningsYield: valuesOf(all, 'earningsYield'),
    bookToMarket: valuesOf(all, 'bookToMarket'),
    grossProfitability: valuesOf(all, 'grossProfitability'),
  }
  const ranks = new Map<Ticker, UsFundamentalRanks>()

  for (const [ticker, fundamentals] of entries) {
    const value = meanOf([
      rankOf(populations.earningsYield, fundamentals.earningsYield),
      rankOf(populations.bookToMarket, fundamentals.bookToMarket),
    ])
    const quality = rankOf(populations.grossProfitability, fundamentals.grossProfitability)

    ranks.set(ticker, {
      ...(value === undefined ? {} : { value }),
      ...(quality === undefined ? {} : { quality }),
    })
  }

  return ranks
}

function valuesOf(entries: readonly UsFundamentals[], key: keyof UsFundamentals): number[] {
  return entries.flatMap((entry) => entry[key] ?? [])
}

function rankOf(population: readonly number[], value: number | undefined): number | undefined {
  return value === undefined ? undefined : rankWithin(population, value)
}

function meanOf(values: readonly (number | undefined)[]): number | undefined {
  const present = values.filter((value): value is number => value !== undefined)

  return present.length === 0
    ? undefined
    : present.reduce((sum, value) => sum + value, 0) / present.length
}
