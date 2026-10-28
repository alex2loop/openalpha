import type { TradingDay } from '@/trading/kernel/instrument'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'

export interface StoredSeriesPoint {
  readonly day: TradingDay
  readonly value: number
  readonly fetchedAt: number
}

export interface FindLatestSeriesPointOptions {
  readonly seriesId: string
  readonly signal: AbortSignal
}

export async function findLatestSeriesPoint(
  deps: StoreDeps,
  options: FindLatestSeriesPointOptions
): Promise<StoredSeriesPoint | null> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<{ day: string; value: number; fetched_at: number }>(
    `SELECT day, value, fetched_at FROM series_points WHERE series_id = ${p(1)} ` +
      'ORDER BY day DESC LIMIT 1',
    [options.seriesId]
  )
  const row = rows[0]

  return row ? { day: tradingDay(row.day), value: row.value, fetchedAt: row.fetched_at } : null
}
