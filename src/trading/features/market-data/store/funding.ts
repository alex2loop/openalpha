import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { FundingSnapshot } from '@/trading/kernel/market/market-data'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { marketRef, ticker, tradingDay } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { toBindChunks } from '@/trading/kernel/store/store-row'

const FUNDING_KEYS = ['market', 'ticker', 'as_of', 'source_id']
const FUNDING_COLS = [
  'observed_at',
  'funding_daily_pct',
  'window_days',
  'open_interest_usd',
  'open_interest_ratio',
  'open_interest_sessions',
  'open_interest_change',
  'open_interest_change_sessions',
  'long_short_ratio',
  'fetched_at',
]

interface FundingRow {
  readonly market: string
  readonly ticker: string
  readonly as_of: string
  readonly source_id: string
  readonly observed_at: number
  readonly funding_daily_pct: number
  readonly window_days: number
  readonly open_interest_usd: number | null
  readonly open_interest_ratio: number | null
  readonly open_interest_sessions: number | null
  readonly open_interest_change: number | null
  readonly open_interest_change_sessions: number | null
  readonly long_short_ratio: number | null
  readonly fetched_at: number
}

export interface FindFundingOptions {
  readonly instrument: InstrumentRef
  readonly asOf: TradingDay
  readonly signal: AbortSignal
}

export async function upsertFunding(
  deps: StoreDeps,
  records: readonly FundingSnapshot[],
  signal: AbortSignal
): Promise<void> {
  assertNotAborted(signal)

  if (records.length === 0) {
    return
  }

  const columnCount = FUNDING_KEYS.length + FUNDING_COLS.length

  await deps.db.transaction(async (tx) => {
    for (const chunk of toBindChunks(records, columnCount)) {
      assertNotAborted(signal)
      await tx.execute(
        deps.dialect.upsert('funding_snapshots', {
          keys: FUNDING_KEYS,
          cols: FUNDING_COLS,
          rowCount: chunk.length,
        }),
        chunk.flatMap(toFundingValues)
      )
    }
  })
}

/** Two sources may both hold the day, since the key includes `source_id`; the most recently
 *  fetched answers rather than whichever row the engine returned first. */
export async function findFunding(
  deps: StoreDeps,
  options: FindFundingOptions
): Promise<FundingSnapshot | null> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<FundingRow>(
    `SELECT * FROM funding_snapshots WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
      `AND as_of = ${p(3)} ORDER BY fetched_at DESC LIMIT 1`,
    [options.instrument.market, options.instrument.ticker, options.asOf]
  )
  const row = rows[0]

  return row === undefined ? null : toFunding(row)
}

function toFundingValues(record: FundingSnapshot): readonly unknown[] {
  return [
    record.instrument.market,
    record.instrument.ticker,
    record.asOf,
    record.sourceId,
    record.observedAt,
    record.fundingDailyPct,
    record.windowDays,
    record.openInterestUsd ?? null,
    record.openInterestRatio?.value ?? null,
    record.openInterestRatio?.sessions ?? null,
    record.openInterestChange?.value ?? null,
    record.openInterestChange?.sessions ?? null,
    record.longShortRatio ?? null,
    record.fetchedAt,
  ]
}

function toFunding(row: FundingRow): FundingSnapshot {
  return {
    sourceId: sourceId(row.source_id),
    fetchedAt: row.fetched_at,
    instrument: { market: marketRef(row.market), ticker: ticker(row.ticker) },
    asOf: tradingDay(row.as_of),
    observedAt: row.observed_at,
    fundingDailyPct: row.funding_daily_pct,
    windowDays: row.window_days,
    ...(row.open_interest_usd === null ? {} : { openInterestUsd: row.open_interest_usd }),
    ...(typeof row.open_interest_ratio !== 'number' ||
    typeof row.open_interest_sessions !== 'number'
      ? {}
      : {
          openInterestRatio: {
            value: row.open_interest_ratio,
            sessions: row.open_interest_sessions,
          },
        }),
    ...(typeof row.open_interest_change !== 'number' ||
    typeof row.open_interest_change_sessions !== 'number'
      ? {}
      : {
          openInterestChange: {
            value: row.open_interest_change,
            sessions: row.open_interest_change_sessions,
          },
        }),
    ...(row.long_short_ratio === null ? {} : { longShortRatio: row.long_short_ratio }),
  }
}
