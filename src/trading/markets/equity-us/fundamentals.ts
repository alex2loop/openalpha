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
  /** Net income over shareholders' equity, ranked only against the name's own listing sector. */
  readonly returnOnEquity?: number
  readonly sector?: string
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

/** Banks, insurers and most filers that tag no gross profit still earn on their equity. Equity at or
 *  below zero (years of buybacks) makes the return meaningless, so it is absent, not ranked. */
export function usFundamentalsOf(
  report: AnnualAccounts | undefined,
  marketCap: number,
  sector: string | undefined
): UsFundamentals {
  const { netProfitToParent, totalEquity, grossProfit, totalAssets } = report?.lines ?? {}

  return {
    ...(sector === undefined ? {} : { sector }),
    ...(netProfitToParent === undefined ? {} : { earningsYield: netProfitToParent / marketCap }),
    ...(totalEquity === undefined ? {} : { bookToMarket: totalEquity / marketCap }),
    ...(grossProfit === undefined || totalAssets === undefined || totalAssets <= 0
      ? {}
      : { grossProfitability: grossProfit / totalAssets }),
    ...(netProfitToParent === undefined || totalEquity === undefined || totalEquity <= 0
      ? {}
      : { returnOnEquity: netProfitToParent / totalEquity }),
  }
}

/** Value is the mean of the earnings-yield and book-to-market ranks that exist; quality is the mean of
 *  the gross-profitability rank and the return-on-equity rank within the sector. Ranking the return
 *  across sectors would read a bank's leverage as quality. A name missing a quality reading would
 *  otherwise score on value alone, and cheap names are rarely the profitable ones: three in five on the
 *  board tag no gross profit, and on 2026-10-30 they held all thirty top screen places. */
export function rankFundamentals(
  entries: ReadonlyMap<Ticker, UsFundamentals>
): ReadonlyMap<Ticker, UsFundamentalRanks> {
  const all = [...entries.values()]
  const populations = {
    earningsYield: valuesOf(all, 'earningsYield'),
    bookToMarket: valuesOf(all, 'bookToMarket'),
    grossProfitability: valuesOf(all, 'grossProfitability'),
  }
  const returnsBySector = Map.groupBy(
    all.filter((entry) => entry.returnOnEquity !== undefined),
    (entry) => entry.sector
  )
  const ranks = new Map<Ticker, UsFundamentalRanks>()

  for (const [ticker, fundamentals] of entries) {
    const value = meanOf([
      rankOf(populations.earningsYield, fundamentals.earningsYield),
      rankOf(populations.bookToMarket, fundamentals.bookToMarket),
    ])
    const quality = meanOf([
      rankOf(populations.grossProfitability, fundamentals.grossProfitability),
      rankOf(
        valuesOf(returnsBySector.get(fundamentals.sector) ?? [], 'returnOnEquity'),
        fundamentals.returnOnEquity
      ),
    ])

    ranks.set(ticker, {
      ...(value === undefined ? {} : { value }),
      ...(quality === undefined ? {} : { quality }),
    })
  }

  return ranks
}

function valuesOf(
  entries: readonly UsFundamentals[],
  key: Exclude<keyof UsFundamentals, 'sector'>
): number[] {
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
