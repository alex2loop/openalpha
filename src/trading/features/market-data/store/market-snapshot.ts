import { z } from 'zod'

import type { InstrumentRef, MarketRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type {
  DailyTradeSides,
  FlowSnapshot,
  FundamentalSnapshot,
} from '@/trading/kernel/market/market-data'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { definedOnly } from '@/core/utils/collections'
import {
  ticker as brandTicker,
  currencyCode,
  marketRef,
  tradingDay,
} from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { parseJson, toBindChunks } from '@/trading/kernel/store/store-row'

const FUNDAMENTAL_KEYS = ['market', 'ticker', 'as_of', 'source_id']
const FUNDAMENTAL_COLS = ['currency', 'reported_on', 'fetched_at', 'payload']
const PROPRIETARY_COL = 'proprietary_net_value'
const FLOW_KEYS = ['market', 'ticker', 'day', 'source_id']
const FLOW_COLS = [
  'currency',
  'foreign_buy_value',
  'foreign_sell_value',
  'foreign_net_value',
  PROPRIETARY_COL,
  'fetched_at',
]
/** One provider fills this leg on some sessions and another on the rest, so a write carrying
 *  neither must not clear a value already stored. */
const FLOW_KEEP_WHEN_NULL = [PROPRIETARY_COL]
const TRADE_SIDES_KEYS = ['market', 'ticker', 'day', 'source_id']
const TRADE_SIDES_COLS = ['buy_volume', 'sell_volume', 'auction_volume', 'fetched_at']

// Every metric is optional because a provider covers a different subset per instrument; the
// snapshot is always read whole, so none of them is a column. Unknown keys are dropped rather than
// rejected: this payload is our own daily-refreshed cache, so a row written before a metric was
// retired must still read back — strict here turns retiring one into a crash on the stored past.
const metricsSchema = z.object({
  returnOnAssetsPct: z.number().finite().optional(),
  returnOnEquityPct: z.number().finite().optional(),
  grossMarginPct: z.number().finite().optional(),
  netMarginPct: z.number().finite().optional(),
  debtToEquity: z.number().finite().optional(),
  revenueGrowthYoyPct: z.number().finite().optional(),
  earningsGrowthYoyPct: z.number().finite().optional(),
  earningsPerShare: z.number().finite().optional(),
  priceToSales: z.number().finite().optional(),
  bookValuePerShare: z.number().finite().optional(),
  marketCap: z.number().finite().optional(),
  sharesOutstanding: z.number().finite().optional(),
  freeFloatPct: z.number().finite().optional(),
})

interface FundamentalRow {
  readonly market: string
  readonly ticker: string
  readonly as_of: string
  readonly source_id: string
  readonly currency: string
  readonly reported_on: string | null
  readonly fetched_at: number
  readonly payload: string
}

interface FlowRow {
  readonly market: string
  readonly ticker: string
  readonly day: string
  readonly source_id: string
  readonly currency: string
  readonly foreign_buy_value: number
  readonly foreign_sell_value: number
  readonly foreign_net_value: number
  readonly proprietary_net_value: number | null
  readonly fetched_at: number
}

interface TradeSidesRow {
  readonly market: string
  readonly ticker: string
  readonly day: string
  readonly source_id: string
  readonly buy_volume: number
  readonly sell_volume: number
  readonly auction_volume: number
  readonly fetched_at: number
}

export interface DayWindowOptions {
  readonly instrument: InstrumentRef
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
  readonly signal: AbortSignal
}

export interface TradeSidesDayOptions {
  readonly market: MarketRef
  readonly day: TradingDay
  readonly signal: AbortSignal
}

interface SharesOutstandingOptions {
  readonly market: MarketRef
  readonly signal: AbortSignal
}

/** Point-in-time snapshots upsert by their natural key and never delete: removing unrelated
 *  history to insert a newer row would destroy the record a stored suggestion cited. One
 *  transaction covers the whole call — the caller passes one snapshot per instrument, so the batch
 *  is already bounded by however many names the universe holds. */
export async function upsertFundamentals(
  deps: StoreDeps,
  records: readonly FundamentalSnapshot[],
  signal: AbortSignal
): Promise<void> {
  assertNotAborted(signal)

  if (records.length === 0) {
    return
  }

  const columnCount = FUNDAMENTAL_KEYS.length + FUNDAMENTAL_COLS.length

  await deps.db.transaction(async (tx) => {
    for (const chunk of toBindChunks(records, columnCount)) {
      assertNotAborted(signal)
      await tx.execute(
        deps.dialect.upsert('fundamental_snapshots', {
          keys: FUNDAMENTAL_KEYS,
          cols: FUNDAMENTAL_COLS,
          rowCount: chunk.length,
        }),
        chunk.flatMap(toFundamentalValues)
      )
    }
  })
}

function toFundamentalValues(record: FundamentalSnapshot): readonly unknown[] {
  return [
    record.instrument.market,
    record.instrument.ticker,
    record.asOf,
    record.sourceId,
    record.currency,
    record.reportedOn ?? null,
    record.fetchedAt,
    JSON.stringify(toMetrics(record)),
  ]
}

export async function findLatestFundamental(
  deps: StoreDeps,
  options: {
    readonly instrument: InstrumentRef
    readonly asOf: TradingDay
    readonly signal: AbortSignal
  }
): Promise<FundamentalSnapshot | null> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<FundamentalRow>(
    `SELECT * FROM fundamental_snapshots WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
      `AND as_of <= ${p(3)} ORDER BY as_of DESC LIMIT 1`,
    [options.instrument.market, options.instrument.ticker, options.asOf]
  )
  const row = rows[0]

  return row ? toFundamental(row) : null
}

/** The latest known share count per ticker — the denominator foreign-room percentages are
 *  computed against. Names without a stored fundamental are simply absent from the map.
 *
 *  The join can return two rows for one ticker when two sources both wrote the market's latest
 *  `as_of` (the write key includes `source_id`); the winner is picked explicitly below by most
 *  recent `fetched_at` rather than left to whichever row the query happened to return last. */
export async function listSharesOutstanding(
  deps: StoreDeps,
  options: SharesOutstandingOptions
): Promise<ReadonlyMap<Ticker, number>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<{
    readonly ticker: string
    readonly payload: string
    readonly fetched_at: number
  }>(
    `SELECT f.ticker, f.payload, f.fetched_at FROM fundamental_snapshots f ` +
      `JOIN (SELECT ticker, MAX(as_of) AS latest FROM fundamental_snapshots ` +
      `WHERE market = ${p(1)} GROUP BY ticker) l ` +
      `ON f.market = ${p(2)} AND f.ticker = l.ticker AND f.as_of = l.latest`,
    [options.market, options.market]
  )
  const winners = new Map<
    Ticker,
    { readonly sharesOutstanding: number; readonly fetchedAt: number }
  >()

  for (const row of rows) {
    const metrics = parseJson(row.payload, 'fundamental snapshot', (value) =>
      metricsSchema.parse(value)
    )

    if (metrics.sharesOutstanding === undefined || metrics.sharesOutstanding <= 0) {
      continue
    }

    const ticker = brandTicker(row.ticker)
    const current = winners.get(ticker)

    if (current === undefined || row.fetched_at > current.fetchedAt) {
      winners.set(ticker, {
        sharesOutstanding: metrics.sharesOutstanding,
        fetchedAt: row.fetched_at,
      })
    }
  }

  return new Map([...winners].map(([ticker, entry]) => [ticker, entry.sharesOutstanding]))
}

/** One transaction over the whole set, one statement per bind chunk. Grouping by instrument existed
 *  only to bound the statement count per transaction, which the chunking now does directly. */
export async function upsertFlows(
  deps: StoreDeps,
  records: readonly FlowSnapshot[],
  signal: AbortSignal
): Promise<void> {
  assertNotAborted(signal)

  if (records.length === 0) {
    return
  }

  const columnCount = FLOW_KEYS.length + FLOW_COLS.length

  await deps.db.transaction(async (tx) => {
    for (const chunk of toBindChunks(records, columnCount)) {
      assertNotAborted(signal)
      await tx.execute(
        deps.dialect.upsert('foreign_flow_snapshots', {
          keys: FLOW_KEYS,
          cols: FLOW_COLS,
          keepWhenNull: FLOW_KEEP_WHEN_NULL,
          rowCount: chunk.length,
        }),
        chunk.flatMap(toFlowValues)
      )
    }
  })
}

function toFlowValues(record: FlowSnapshot): readonly unknown[] {
  return [
    record.instrument.market,
    record.instrument.ticker,
    record.at,
    record.sourceId,
    record.currency,
    record.foreignBuyValue,
    record.foreignSellValue,
    record.foreignNetValue,
    record.proprietaryNetValue ?? null,
    record.fetchedAt,
  ]
}

export async function listFlows(
  deps: StoreDeps,
  options: DayWindowOptions
): Promise<readonly FlowSnapshot[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<FlowRow>(
    `SELECT * FROM foreign_flow_snapshots WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
      `AND day >= ${p(3)} AND day <= ${p(4)} ORDER BY day`,
    [options.instrument.market, options.instrument.ticker, options.fromDay, options.toDay]
  )

  return rows.map(toFlow)
}

export async function upsertTradeSides(
  deps: StoreDeps,
  records: readonly DailyTradeSides[],
  signal: AbortSignal
): Promise<void> {
  assertNotAborted(signal)

  if (records.length === 0) {
    return
  }

  const columnCount = TRADE_SIDES_KEYS.length + TRADE_SIDES_COLS.length

  await deps.db.transaction(async (tx) => {
    for (const chunk of toBindChunks(records, columnCount)) {
      assertNotAborted(signal)
      await tx.execute(
        deps.dialect.upsert('daily_trade_sides', {
          keys: TRADE_SIDES_KEYS,
          cols: TRADE_SIDES_COLS,
          rowCount: chunk.length,
        }),
        chunk.flatMap(toTradeSidesValues)
      )
    }
  })
}

function toTradeSidesValues(record: DailyTradeSides): readonly unknown[] {
  return [
    record.instrument.market,
    record.instrument.ticker,
    record.at,
    record.sourceId,
    record.buyVolume,
    record.sellVolume,
    record.auctionVolume,
    record.fetchedAt,
  ]
}

export async function listTradeSides(
  deps: StoreDeps,
  options: DayWindowOptions
): Promise<readonly DailyTradeSides[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<TradeSidesRow>(
    `SELECT * FROM daily_trade_sides WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
      `AND day >= ${p(3)} AND day <= ${p(4)} ORDER BY day`,
    [options.instrument.market, options.instrument.ticker, options.fromDay, options.toDay]
  )

  return rows.map(toTradeSides)
}

/** Every name recorded for one session, rather than a list of names to look up. The sweep decides
 *  which names it can reach; asking the store what it holds keeps a reader from carrying a second,
 *  drifting copy of that decision. */
export async function listTradeSidesDay(
  deps: StoreDeps,
  options: TradeSidesDayOptions
): Promise<readonly DailyTradeSides[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<TradeSidesRow>(
    `SELECT * FROM daily_trade_sides WHERE market = ${p(1)} AND day = ${p(2)} ORDER BY ticker`,
    [options.market, options.day]
  )

  return rows.map(toTradeSides)
}

function toTradeSides(row: TradeSidesRow): DailyTradeSides {
  return {
    sourceId: sourceId(row.source_id),
    fetchedAt: row.fetched_at,
    instrument: toInstrument(row.market, row.ticker),
    at: tradingDay(row.day),
    buyVolume: row.buy_volume,
    sellVolume: row.sell_volume,
    auctionVolume: row.auction_volume,
  }
}

function toMetrics(record: FundamentalSnapshot): z.infer<typeof metricsSchema> {
  return {
    returnOnAssetsPct: record.returnOnAssetsPct,
    returnOnEquityPct: record.returnOnEquityPct,
    grossMarginPct: record.grossMarginPct,
    netMarginPct: record.netMarginPct,
    debtToEquity: record.debtToEquity,
    revenueGrowthYoyPct: record.revenueGrowthYoyPct,
    earningsGrowthYoyPct: record.earningsGrowthYoyPct,
    earningsPerShare: record.earningsPerShare,
    priceToSales: record.priceToSales,
    bookValuePerShare: record.bookValuePerShare,
    marketCap: record.marketCap,
    sharesOutstanding: record.sharesOutstanding,
    freeFloatPct: record.freeFloatPct,
  }
}

function toFundamental(row: FundamentalRow): FundamentalSnapshot {
  const metrics = parseJson(row.payload, 'fundamental snapshot', (value) =>
    metricsSchema.parse(value)
  )

  return {
    ...definedOnly(metrics),
    sourceId: sourceId(row.source_id),
    fetchedAt: row.fetched_at,
    instrument: toInstrument(row.market, row.ticker),
    asOf: tradingDay(row.as_of),
    currency: currencyCode(row.currency),
    ...(row.reported_on === null ? {} : { reportedOn: tradingDay(row.reported_on) }),
  }
}

function toFlow(row: FlowRow): FlowSnapshot {
  return {
    sourceId: sourceId(row.source_id),
    fetchedAt: row.fetched_at,
    instrument: toInstrument(row.market, row.ticker),
    at: tradingDay(row.day),
    currency: currencyCode(row.currency),
    foreignBuyValue: row.foreign_buy_value,
    foreignSellValue: row.foreign_sell_value,
    foreignNetValue: row.foreign_net_value,
    ...(row.proprietary_net_value === null
      ? {}
      : { proprietaryNetValue: row.proprietary_net_value }),
  }
}

function toInstrument(market: string, symbol: string): InstrumentRef {
  return { market: marketRef(market), ticker: brandTicker(symbol) }
}
