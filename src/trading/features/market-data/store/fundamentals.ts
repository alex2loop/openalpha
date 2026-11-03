import type { FundamentalRow } from '@/trading/features/market-data/store/market-snapshot'
import type { MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { FundamentalSnapshot } from '@/trading/kernel/market/market-data'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { toFundamental } from '@/trading/features/market-data/store/market-snapshot'

interface LatestFundamentalsOptions {
  readonly market: MarketRef
  /** Snapshots stamped before this day are not read: a name last snapshotted long ago has left
   *  the set the refresh keeps current. */
  readonly fromDay: TradingDay
  readonly signal: AbortSignal
}

/** The newest snapshot per name stamped on or after `fromDay`. */
export interface LatestFundamentalsRead {
  listLatestFundamentals(
    options: LatestFundamentalsOptions
  ): Promise<readonly FundamentalSnapshot[]>
}

/** The newest snapshot per name since `fromDay`, in one statement. Two sources writing the same
 *  `as_of` leave two rows for a name; the more recently fetched one wins. */
export async function listLatestFundamentals(
  deps: StoreDeps,
  options: LatestFundamentalsOptions
): Promise<readonly FundamentalSnapshot[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<FundamentalRow>(
    `SELECT f.* FROM fundamental_snapshots f ` +
      `JOIN (SELECT ticker, MAX(as_of) AS latest FROM fundamental_snapshots ` +
      `WHERE market = ${p(1)} AND as_of >= ${p(2)} GROUP BY ticker) l ` +
      `ON f.market = ${p(3)} AND f.ticker = l.ticker AND f.as_of = l.latest`,
    [options.market, options.fromDay, options.market]
  )
  const newest = new Map<string, FundamentalRow>()

  for (const row of rows) {
    const current = newest.get(row.ticker)

    if (current === undefined || row.fetched_at > current.fetched_at) {
      newest.set(row.ticker, row)
    }
  }

  return [...newest.values()].map(toFundamental)
}
