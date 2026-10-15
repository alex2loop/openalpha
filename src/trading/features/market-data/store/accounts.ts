import { z } from 'zod'

import type { Transaction } from '@/core/types/storage'
import type { InstrumentRef, MarketRef, Ticker } from '@/trading/kernel/instrument'
import type {
  AccountLines,
  AnnualAccounts,
  FiledAccounts,
  FiscalQuarter,
  QuarterlyAccounts,
} from '@/trading/kernel/market/annual-accounts'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted, ValidationError } from '@/core/errors'
import { definedOnly } from '@/core/utils/collections'
import { ticker as brandTicker, marketRef, tradingDay } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { parseJson, toBindChunks } from '@/trading/kernel/store/store-row'

const ACCOUNTS_KEYS = ['market', 'ticker', 'fiscal_year']
const QUARTER_KEYS = ['market', 'ticker', 'fiscal_year', 'fiscal_quarter']
const FISCAL_QUARTERS: readonly FiscalQuarter[] = Object.freeze([1, 2, 3, 4])
const ACCOUNTS_COLS = ['source_id', 'published_on', 'fetched_at', 'payload']

const LINE = z.number().finite().optional()

// Unknown keys are dropped rather than rejected, as for the fundamentals payload: a line retired
// from the adapter must not make the stored years unreadable.
const LINES_SHAPE = {
  totalAssets: LINE,
  currentAssets: LINE,
  currentLiabilities: LINE,
  longTermDebt: LINE,
  tradeReceivables: LINE,
  netFixedAssets: LINE,
  netRevenue: LINE,
  grossProfit: LINE,
  sellingExpenses: LINE,
  adminExpenses: LINE,
  netProfitToParent: LINE,
  operatingCashFlow: LINE,
  depreciation: LINE,
  shareIssueProceeds: LINE,
  cashAndEquivalents: LINE,
  shortTermInvestments: LINE,
  inventories: LINE,
  shortTermDebt: LINE,
  customerAdvances: LINE,
  longTermCustomerAdvances: LINE,
  totalEquity: LINE,
  minorityInterests: LINE,
  commonShareCapital: LINE,
  interestExpense: LINE,
  preTaxProfit: LINE,
  incomeTax: LINE,
  capitalExpenditure: LINE,
  shareRepurchases: LINE,
  cashDividendsPaid: LINE,
  customerLoans: LINE,
  loanLossReserve: LINE,
  customerDeposits: LINE,
  currentDeposits: LINE,
  watchListLoans: LINE,
  substandardLoans: LINE,
  doubtfulLoans: LINE,
  lossLoans: LINE,
  netInterestIncome: LINE,
  operatingIncome: LINE,
  operatingExpenses: LINE,
  capitalAdequacy: LINE,
} satisfies Readonly<Record<keyof AccountLines, typeof LINE>>
const linesSchema = z.object(LINES_SHAPE)

interface AccountsRow {
  readonly market: string
  readonly ticker: string
  readonly fiscal_year: number
  readonly source_id: string
  readonly published_on: string
  readonly fetched_at: number
  readonly payload: string
}

interface QuarterlyAccountsRow extends AccountsRow {
  readonly fiscal_quarter: number
}

interface UpsertTable<T> {
  readonly table: string
  readonly keys: readonly string[]
  readonly records: readonly T[]
  toValues(record: T): readonly unknown[]
}

export interface ListAccountsOptions {
  readonly market: MarketRef
  readonly signal: AbortSignal
}

/** A refetch overwrites the report: the provider serves only a report's newest version, so a
 *  restatement replaces the original, and every served report's `fetched_at` moves with it. Both
 *  tables in one transaction, so a read never sees a name's years from one fetch and its quarters
 *  from another. */
export async function upsertAccounts(
  deps: StoreDeps,
  filed: FiledAccounts,
  signal: AbortSignal
): Promise<void> {
  assertNotAborted(signal)

  if (filed.annual.length === 0 && filed.quarters.length === 0) {
    return
  }

  await deps.db.transaction(async (tx) => {
    const write = { deps, tx, signal }

    await upsertChunks(write, {
      table: 'annual_accounts',
      keys: ACCOUNTS_KEYS,
      records: filed.annual,
      toValues: toAccountsValues,
    })
    await upsertChunks(write, {
      table: 'quarterly_accounts',
      keys: QUARTER_KEYS,
      records: filed.quarters,
      toValues: toQuarterlyValues,
    })
  })
}

/** One read for the whole market: the cross-section scores every name, and a few thousand small
 *  rows cost less than one point read per name. */
export async function listAnnualAccounts(
  deps: StoreDeps,
  options: ListAccountsOptions
): Promise<ReadonlyMap<Ticker, readonly AnnualAccounts[]>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<AccountsRow>(
    `SELECT * FROM annual_accounts WHERE market = ${p(1)} ORDER BY ticker, fiscal_year`,
    [options.market]
  )

  return groupByTicker(rows.map(toAccountsRecord))
}

export async function listQuarterlyAccounts(
  deps: StoreDeps,
  options: ListAccountsOptions
): Promise<ReadonlyMap<Ticker, readonly QuarterlyAccounts[]>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<QuarterlyAccountsRow>(
    `SELECT * FROM quarterly_accounts WHERE market = ${p(1)} ` +
      'ORDER BY ticker, fiscal_year, fiscal_quarter',
    [options.market]
  )

  return groupByTicker(rows.map(toQuarterlyRecord))
}

async function upsertChunks<T>(
  write: { readonly deps: StoreDeps; readonly tx: Transaction; readonly signal: AbortSignal },
  input: UpsertTable<T>
): Promise<void> {
  const columnCount = input.keys.length + ACCOUNTS_COLS.length

  for (const chunk of toBindChunks(input.records, columnCount)) {
    assertNotAborted(write.signal)
    await write.tx.execute(
      write.deps.dialect.upsert(input.table, {
        keys: input.keys,
        cols: ACCOUNTS_COLS,
        rowCount: chunk.length,
      }),
      chunk.flatMap(input.toValues)
    )
  }
}

function groupByTicker<T extends { readonly instrument: InstrumentRef }>(
  records: readonly T[]
): ReadonlyMap<Ticker, readonly T[]> {
  const byTicker = new Map<Ticker, T[]>()

  for (const record of records) {
    const reports = byTicker.get(record.instrument.ticker) ?? []

    reports.push(record)
    byTicker.set(record.instrument.ticker, reports)
  }

  return byTicker
}

function toAccountsValues(record: AnnualAccounts): readonly unknown[] {
  return [
    record.instrument.market,
    record.instrument.ticker,
    record.fiscalYear,
    record.sourceId,
    record.publishedOn,
    record.fetchedAt,
    JSON.stringify(record.lines),
  ]
}

function toQuarterlyValues(record: QuarterlyAccounts): readonly unknown[] {
  return [
    record.instrument.market,
    record.instrument.ticker,
    record.fiscalYear,
    record.quarter,
    record.sourceId,
    record.publishedOn,
    record.fetchedAt,
    JSON.stringify(record.lines),
  ]
}

function toAccountsRecord(row: AccountsRow): AnnualAccounts {
  const lines = parseJson(row.payload, 'accounts', (value) => linesSchema.parse(value))

  return {
    instrument: { market: marketRef(row.market), ticker: brandTicker(row.ticker) },
    fiscalYear: row.fiscal_year,
    publishedOn: tradingDay(row.published_on),
    lines: definedOnly(lines),
    sourceId: sourceId(row.source_id),
    fetchedAt: row.fetched_at,
  }
}

function toQuarterlyRecord(row: QuarterlyAccountsRow): QuarterlyAccounts {
  return { ...toAccountsRecord(row), quarter: toQuarter(row.fiscal_quarter) }
}

function toQuarter(value: number): FiscalQuarter {
  const quarter = FISCAL_QUARTERS.find((candidate) => candidate === value)

  if (quarter === undefined) {
    throw new ValidationError(`quarterly accounts row carries quarter ${value}`)
  }

  return quarter
}
