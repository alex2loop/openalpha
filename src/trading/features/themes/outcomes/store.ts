import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import type { Transaction } from '@/core/types/storage'
import type {
  StockRead,
  ThemeId,
  ThemeReadLevel,
  ThemeSector,
} from '@/trading/features/themes/types'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { OperationTickOptions, Page } from '@/trading/kernel/store/page'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { shiftMonths } from '@/trading/features/themes/evidence/series'
import { OUTCOME_HORIZONS_MONTHS, themeId } from '@/trading/features/themes/types'
import { ticker, tradingDay } from '@/trading/kernel/instrument'
import { ICB_SUPERSECTORS } from '@/trading/kernel/market/market-data'
import { toBindChunks, toPage } from '@/trading/kernel/store/store-row'

const PENDING_COLUMNS = [
  'id',
  'run_id',
  'theme_id',
  'ticker',
  'sector',
  'horizon_months',
  'entry_day',
  'entry_close',
  'entry_benchmark',
  'due_day',
] as const
const STOCK_LEVEL: ThemeReadLevel = 'stock'
const SECTOR_LEVEL: ThemeReadLevel = 'sector'
const SECTOR = z.enum(ICB_SUPERSECTORS)

export interface PendingOutcome {
  readonly id: string
  readonly ticker: Ticker
  readonly entryDay: TradingDay
  readonly entryClose: number
  readonly entryBenchmark: number
  readonly dueDay: TradingDay
}

export interface ThemeOutcomeResolution {
  readonly resolvedAt: number
  readonly exitDay: TradingDay
  /** Fractions, close to close. */
  readonly stockReturn: number
  readonly benchmarkReturn: number
}

export interface ThemeOutcome {
  readonly runId: string
  readonly themeId: ThemeId
  readonly ticker: Ticker
  readonly sector: ThemeSector
  readonly horizonMonths: number
  readonly entryDay: TradingDay
  readonly dueDay: TradingDay
  readonly stockScore?: number
  readonly sectorScore?: number
  /** Absent while the row is pending. */
  readonly result?: Pick<ThemeOutcomeResolution, 'stockReturn' | 'benchmarkReturn'>
}

export interface DueOutcomeOptions extends OperationTickOptions<string> {
  readonly today: TradingDay
}

interface PendingRow {
  readonly id: string
  readonly ticker: string
  readonly entry_day: string
  readonly entry_close: number
  readonly entry_benchmark: number
  readonly due_day: string
}

interface OutcomeRow {
  readonly run_id: string
  readonly theme_id: string
  readonly ticker: string
  readonly sector: string
  readonly horizon_months: number
  readonly entry_day: string
  readonly due_day: string
  readonly stock_return: number | null
  readonly benchmark_return: number | null
  readonly stock_score: number | null
  readonly sector_score: number | null
}

/** A row per horizon for each stock read that carries both closes, inside the run's transaction so
 *  a cancelled run leaves none. A read without a close has nothing to be measured from. */
export async function insertPendingOutcomes(
  tx: Transaction,
  deps: StoreDeps,
  input: { readonly runId: string; readonly stocks: readonly StockRead[] }
): Promise<void> {
  const rows = input.stocks.flatMap((read) => toPendingValues(input.runId, read))

  for (const chunk of toBindChunks(rows, PENDING_COLUMNS.length)) {
    await tx.execute(
      deps.dialect.insert('theme_outcomes', { cols: PENDING_COLUMNS, rowCount: chunk.length }),
      chunk.flat()
    )
  }
}

function toPendingValues(runId: string, read: StockRead): readonly (readonly unknown[])[] {
  const { close, benchmark } = read

  if (close === undefined || benchmark === undefined) {
    return []
  }

  return OUTCOME_HORIZONS_MONTHS.map((months) => [
    randomUUID(),
    runId,
    read.themeId,
    read.ticker,
    read.sector,
    months,
    close.day,
    close.value,
    benchmark.value,
    shiftMonths(close.day, months),
  ])
}

/** Keyset over the id, so a row still waiting for its bars never starves the rows after it. */
export async function listDueOutcomes(
  deps: StoreDeps,
  options: DueOutcomeOptions
): Promise<Page<PendingOutcome, string>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const params = [
    options.today,
    ...(options.cursor === undefined ? [] : [options.cursor]),
    options.batchSize + 1,
  ]
  const after = options.cursor === undefined ? '' : ` AND id > ${p(2)}`
  const rows = await deps.db.query<PendingRow>(
    'SELECT id, ticker, entry_day, entry_close, entry_benchmark, due_day FROM theme_outcomes ' +
      `WHERE resolved_at IS NULL AND due_day <= ${p(1)}${after} ` +
      `ORDER BY id LIMIT ${p(params.length)}`,
    params
  )

  return toPage(rows.map(toPending), options.batchSize, (row) => row.id)
}

function toPending(row: PendingRow): PendingOutcome {
  return {
    id: row.id,
    ticker: ticker(row.ticker),
    entryDay: tradingDay(row.entry_day),
    entryClose: Number(row.entry_close),
    entryBenchmark: Number(row.entry_benchmark),
    dueDay: tradingDay(row.due_day),
  }
}

/** Only a row still pending, so a second process resolving the same row changes nothing. */
export async function resolveOutcome(
  deps: StoreDeps,
  input: {
    readonly id: string
    readonly resolution: ThemeOutcomeResolution
    readonly signal: AbortSignal
  }
): Promise<boolean> {
  assertNotAborted(input.signal)

  const p = deps.dialect.param
  const { resolution } = input
  const result = await deps.db.execute(
    `UPDATE theme_outcomes SET resolved_at = ${p(1)}, exit_day = ${p(2)}, ` +
      `stock_return = ${p(3)}, benchmark_return = ${p(4)} ` +
      `WHERE id = ${p(5)} AND resolved_at IS NULL`,
    [
      resolution.resolvedAt,
      resolution.exitDay,
      resolution.stockReturn,
      resolution.benchmarkReturn,
      input.id,
    ]
  )

  return result.changes === 1
}

/** Every row, pending ones included, with the score its stock read and its sector read carried:
 *  a sector is judged only once every name under it has resolved. About 45 rows a run. */
export async function listOutcomes(
  deps: StoreDeps,
  signal: AbortSignal
): Promise<readonly ThemeOutcome[]> {
  assertNotAborted(signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<OutcomeRow>(
    'SELECT o.run_id, o.theme_id, o.ticker, o.sector, o.horizon_months, o.entry_day, ' +
      'o.due_day, o.stock_return, o.benchmark_return, stock_read.score AS stock_score, ' +
      'sector_read.score AS sector_score ' +
      'FROM theme_outcomes o ' +
      'LEFT JOIN theme_reads stock_read ON stock_read.run_id = o.run_id ' +
      `AND stock_read.theme_id = o.theme_id AND stock_read.level = ${p(1)} ` +
      'AND stock_read.subject = o.ticker ' +
      'LEFT JOIN theme_reads sector_read ON sector_read.run_id = o.run_id ' +
      `AND sector_read.theme_id = o.theme_id AND sector_read.level = ${p(2)} ` +
      'AND sector_read.subject = o.sector',
    [STOCK_LEVEL, SECTOR_LEVEL]
  )

  return rows.map(toOutcome)
}

function toOutcome(row: OutcomeRow): ThemeOutcome {
  return {
    runId: row.run_id,
    themeId: themeId(row.theme_id),
    ticker: ticker(row.ticker),
    sector: SECTOR.parse(row.sector),
    horizonMonths: Number(row.horizon_months),
    entryDay: tradingDay(row.entry_day),
    dueDay: tradingDay(row.due_day),
    ...(row.stock_score === null ? {} : { stockScore: Number(row.stock_score) }),
    ...(row.sector_score === null ? {} : { sectorScore: Number(row.sector_score) }),
    ...(row.stock_return === null || row.benchmark_return === null
      ? {}
      : {
          result: {
            stockReturn: Number(row.stock_return),
            benchmarkReturn: Number(row.benchmark_return),
          },
        }),
  }
}
