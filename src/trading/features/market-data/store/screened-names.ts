import { z } from 'zod'

import type { MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { parseJson } from '@/trading/kernel/store/store-row'

const SCREENED_KEYS = ['market']
const SCREENED_COLS = ['as_of', 'stamp', 'tickers']
const STAMP_SEPARATOR = '|'

const tickersSchema = z.array(z.string())

interface ScreenedRow {
  readonly as_of: string
  readonly stamp: string
  readonly tickers: string
}

interface StampRow {
  readonly [column: string]: number | string | null
}

interface ScreenedNamesOptions {
  readonly market: MarketRef
  readonly signal: AbortSignal
}

/** The names a pass found screened, with the session and evidence stamp it read them against. */
interface ScreenedNames {
  readonly asOf: TradingDay
  readonly stamp: string
  readonly tickers: readonly string[]
}

interface SaveScreenedNamesOptions extends ScreenedNamesOptions {
  readonly names: ScreenedNames
}

/** The screen's names kept between passes, so a pass that changed nothing need not read the board
 *  again. */
export interface ScreenedNamesStore {
  /** Null where no pass has stored one for the market. */
  findScreenedNames(options: ScreenedNamesOptions): Promise<ScreenedNames | null>
  saveScreenedNames(options: SaveScreenedNamesOptions): Promise<void>
  /** A fingerprint of the stored evidence a screen reads: equal stamps mean the same screen. */
  readScreenStamp(options: ScreenedNamesOptions): Promise<string>
}

export function createScreenedNamesStore(deps: StoreDeps): ScreenedNamesStore {
  return {
    findScreenedNames: (options) => findScreenedNames(deps, options),
    saveScreenedNames: (options) => saveScreenedNames(deps, options),
    readScreenStamp: (options) => readScreenStamp(deps, options),
  }
}

async function findScreenedNames(
  deps: StoreDeps,
  options: ScreenedNamesOptions
): Promise<ScreenedNames | null> {
  assertNotAborted(options.signal)

  const rows = await deps.db.query<ScreenedRow>(
    `SELECT as_of, stamp, tickers FROM screened_names WHERE market = ${deps.dialect.param(1)}`,
    [options.market]
  )
  const row = rows[0]

  return row === undefined
    ? null
    : {
        asOf: tradingDay(row.as_of),
        stamp: row.stamp,
        tickers: parseJson(row.tickers, 'screened names', (value) => tickersSchema.parse(value)),
      }
}

async function saveScreenedNames(
  deps: StoreDeps,
  options: SaveScreenedNamesOptions
): Promise<void> {
  assertNotAborted(options.signal)

  const { names } = options
  const sql = deps.dialect.upsert('screened_names', {
    keys: SCREENED_KEYS,
    cols: SCREENED_COLS,
    rowCount: 1,
  })

  await deps.db.execute(sql, [
    options.market,
    names.asOf,
    names.stamp,
    JSON.stringify(names.tickers),
  ])
}

/** What a screen reads, as one string that moves when any of it is written or deleted: the newest
 *  fetch and the row count of the bars and instruments, and the newest fundamental. Flows and
 *  accounts feed no gate, so a write to either leaves it alone. Every term is an index lookup. */
async function readScreenStamp(deps: StoreDeps, options: ScreenedNamesOptions): Promise<string> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param(1)
  const rows = await deps.db.query<StampRow>(
    `SELECT (SELECT MAX(fetched_at) FROM daily_bars WHERE market = ${p}) AS bars_at, ` +
      `(SELECT COUNT(*) FROM daily_bars WHERE market = ${p}) AS bars_count, ` +
      `(SELECT MAX(fetched_at) FROM fundamental_snapshots WHERE market = ${p}) AS fundamentals_at, ` +
      `(SELECT MAX(fetched_at) FROM instruments WHERE market = ${p}) AS instruments_at, ` +
      `(SELECT COUNT(*) FROM instruments WHERE market = ${p}) AS instruments_count`,
    [options.market]
  )

  return Object.values(rows[0] ?? {})
    .map(String)
    .join(STAMP_SEPARATOR)
}
