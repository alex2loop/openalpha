import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorMetric, FactorMetricId } from '@/trading/kernel/factor-metric'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type {
  AccountsHistory,
  AccountsYear,
  AnnualAccounts,
  QuarterlyAccounts,
} from '@/trading/kernel/market/annual-accounts'
import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { BankBooks } from '@/trading/markets/equity-vn/accounts/bank-books'
import type { AccountsReading } from '@/trading/markets/equity-vn/accounts/score'
import { bankBooksCaveats, readBankBooks } from '@/trading/markets/equity-vn/accounts/bank-books'
import { toAccountsHistory } from '@/trading/markets/equity-vn/accounts/history'
import {
  accountsCaveats,
  accountsMetrics,
  finalFiscalYear,
  isAccountsDecisive,
  scoreNameAccounts,
} from '@/trading/markets/equity-vn/accounts/score'
import { BANK_SECTOR } from '@/trading/markets/equity-vn/policy'

type MetricEntry = readonly [FactorMetricId, number | undefined]

/** Everything the board reads of one name's annual reports on one board day. */
export interface NameAccounts {
  readonly score?: AccountsReading
  readonly books?: BankBooks
  readonly history?: AccountsHistory
  /** The history's newest year, only when it is the final year this board day reads: a late or
   *  lapsed filer's old figures and flags print in the tool's table beside their year, never
   *  unlabelled on the quality line. */
  readonly current?: AccountsYear
}

interface BoardAccountsInput {
  readonly universe: readonly InstrumentRecord[]
  readonly reports: ReadonlyMap<Ticker, readonly AnnualAccounts[]>
  readonly quarters: ReadonlyMap<Ticker, readonly QuarterlyAccounts[]>
  readonly asOf: TradingDay
}

interface NameAccountsInput {
  readonly record: InstrumentRecord
  readonly reports: readonly AnnualAccounts[]
  readonly quarters: readonly QuarterlyAccounts[]
  readonly asOf: TradingDay
}

/** Read once per board day, so the quality line, the thesis sale, the tool and the debate read one set of numbers. */
export function readBoardAccounts(input: BoardAccountsInput): ReadonlyMap<Ticker, NameAccounts> {
  const board = new Map<Ticker, NameAccounts>()

  for (const record of input.universe) {
    const { ticker } = record.instrument
    const reports = input.reports.get(ticker)
    const entry =
      reports === undefined
        ? undefined
        : readNameAccounts({
            record,
            reports,
            quarters: input.quarters.get(ticker) ?? [],
            asOf: input.asOf,
          })

    if (entry !== undefined) {
      board.set(record.instrument.ticker, entry)
    }
  }

  return board
}

/** The quality factor's report lines. */
export function accountsQualityExtras(entry: NameAccounts | undefined): {
  readonly metrics: readonly FactorMetric[]
  readonly caveats: readonly Caveat[]
} {
  return {
    metrics: [
      ...accountsMetrics(entry?.score),
      ...bankBooksMetrics(entry?.books),
      ...historyMetrics(entry?.current),
    ],
    caveats: [
      ...accountsCaveats(entry?.score),
      ...bankBooksCaveats(entry?.books),
      ...(entry?.current === undefined ? [] : (entry.history?.caveats ?? [])),
    ],
  }
}

/** The value factor's report line prices against this, so a peak year's profit cannot read as
 *  cheapness on its own. */
export function accountsAverageProfit(entry: NameAccounts | undefined): number | undefined {
  return entry?.current === undefined ? undefined : entry.history?.trend?.averageProfit
}

function readNameAccounts(input: NameAccountsInput): NameAccounts | undefined {
  const { record, reports, asOf } = input
  const score = scoreNameAccounts(record, reports, asOf)
  const books = record.sector === BANK_SECTOR ? readBankBooks(reports, asOf) : undefined
  const history = toAccountsHistory({
    instrument: record.instrument,
    reports,
    quarters: input.quarters,
    asOf,
    readingOnly: !isAccountsDecisive(record),
  })

  const newest = history?.years.at(-1)
  const current = newest?.fiscalYear === finalFiscalYear(asOf) ? newest : undefined

  if (score === undefined && books === undefined && history === undefined) {
    return undefined
  }

  return {
    ...(score === undefined ? {} : { score }),
    ...(books === undefined ? {} : { books }),
    ...(history === undefined ? {} : { history }),
    ...(current === undefined ? {} : { current }),
  }
}

function bankBooksMetrics(books: BankBooks | undefined): readonly FactorMetric[] {
  return definedMetrics([
    ['bad-debt-ratio', books?.badDebtRatio],
    ['watch-list-ratio', books?.watchListRatio],
    ['provision-cover', books?.provisionCover],
    ['casa-share', books?.casaShare],
  ])
}

/** The final year's readings; the multi-year trend stays in the history, where its span is printed
 *  beside it. */
function historyMetrics(newest: AccountsYear | undefined): readonly FactorMetric[] {
  return definedMetrics([
    ['return-on-invested-capital', newest?.returnOnInvestedCapital],
    ['interest-cover', newest?.interestCover],
    ['net-debt-to-ebitda', newest?.netDebtToEbitda],
    ['cost-to-income', newest?.costToIncome],
    ['capital-adequacy', newest?.capitalAdequacy],
    ['net-interest-to-assets', newest?.netInterestToAssets],
  ])
}

function definedMetrics(entries: readonly MetricEntry[]): readonly FactorMetric[] {
  return entries.flatMap(([id, value]) => (value === undefined ? [] : [{ id, value }]))
}
