import type { MarketRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { ticker as brandTicker, tradingDay } from '@/trading/kernel/instrument'

export interface LatestDaysOptions {
  readonly market: MarketRef
  readonly signal: AbortSignal
}

export interface LatestDay {
  readonly day: TradingDay
}

export interface DaysFromOptions extends LatestDaysOptions {
  readonly fromDay: TradingDay
}

/** The newest stored bar day per ticker, which sizes the next fetch window. */
export function listLatestBars(
  deps: StoreDeps,
  options: LatestDaysOptions
): Promise<ReadonlyMap<Ticker, LatestDay>> {
  return latestDays(deps, 'daily_bars', options)
}

/** The newest stored flow day per ticker, which sizes the next fetch window. */
export function listLatestFlowDays(
  deps: StoreDeps,
  options: LatestDaysOptions
): Promise<ReadonlyMap<Ticker, LatestDay>> {
  return latestDays(deps, 'foreign_flow_snapshots', options)
}

/** One grouped read for the whole market: a per-instrument query would issue one round trip per
 *  name on every refresh. */
async function latestDays(
  deps: StoreDeps,
  table: 'daily_bars' | 'foreign_flow_snapshots',
  options: LatestDaysOptions
): Promise<ReadonlyMap<Ticker, LatestDay>> {
  assertNotAborted(options.signal)

  const rows = await deps.db.query<{ readonly ticker: string; readonly day: string }>(
    `SELECT ticker, MAX(day) AS day FROM ${table} WHERE market = ${deps.dialect.param(1)} ` +
      'GROUP BY ticker',
    [options.market]
  )

  return new Map(rows.map((row) => [brandTicker(row.ticker), { day: tradingDay(row.day) }]))
}

/** Every stored close per ticker from `fromDay` on, so a refetched window is held against each
 *  session it overlaps rather than the newest alone: a provider that re-bases a name after the
 *  ex-date leaves that newest close untouched. Two sources can hold one session, since the write
 *  key includes `source_id`; read oldest fetch first, the newest stands, as `listBars` keeps it. */
export async function listBarCloses(
  deps: StoreDeps,
  options: DaysFromOptions
): Promise<ReadonlyMap<Ticker, ReadonlyMap<TradingDay, number>>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<{
    readonly ticker: string
    readonly day: string
    readonly close: number
  }>(
    `SELECT ticker, day, close FROM daily_bars WHERE market = ${p(1)} AND day >= ${p(2)} ` +
      'ORDER BY fetched_at, source_id',
    [options.market, options.fromDay]
  )
  const byTicker = new Map<Ticker, Map<TradingDay, number>>()

  for (const row of rows) {
    const key = brandTicker(row.ticker)
    const closes = byTicker.get(key) ?? new Map<TradingDay, number>()

    closes.set(tradingDay(row.day), row.close)
    byTicker.set(key, closes)
  }

  return byTicker
}

/** Which sessions already carry a proprietary net, per ticker, from `fromDay` on. The desk provider
 *  is asked only for what these leave out: the flows provider's own answer never gains the session
 *  it skipped, so without this the gap reopens on every pass and re-sweeps every name. */
export async function listDeskDays(
  deps: StoreDeps,
  options: DaysFromOptions
): Promise<ReadonlyMap<Ticker, ReadonlySet<TradingDay>>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<{ readonly ticker: string; readonly day: string }>(
    `SELECT ticker, day FROM foreign_flow_snapshots WHERE market = ${p(1)} AND day >= ${p(2)} ` +
      'AND proprietary_net_value IS NOT NULL',
    [options.market, options.fromDay]
  )
  const byTicker = new Map<Ticker, Set<TradingDay>>()

  for (const row of rows) {
    const key = brandTicker(row.ticker)
    const days = byTicker.get(key) ?? new Set<TradingDay>()

    days.add(tradingDay(row.day))
    byTicker.set(key, days)
  }

  return byTicker
}
