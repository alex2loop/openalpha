import type { MarketDataStore } from '@/trading/features/market-data/store/market-data'
import type { NewsArchiveStore } from '@/trading/features/market-data/store/news-archive'
import type { RefreshMarketDataOptions } from '@/trading/kernel/market/refresh'
import type { Market } from '@/trading/markets/types'
import { drainPages, RETENTION_DELETE_LIMIT } from '@/persistence/api'
import { RETENTION_SCOPES, retentionMsOf } from '@/trading/features/market-data/store/market-data'
import { NEWS_RETENTION_MS } from '@/trading/features/market-data/store/news-archive'
import { resolveRetentionMs } from '@/trading/markets/retention'

interface RetentionDeps {
  readonly newsArchive: Pick<NewsArchiveStore, 'deleteFetchedBefore'>
  readonly marketDataStore: Pick<MarketDataStore, 'deleteExpired' | 'deleteMacroRiskBefore'>
}

/** Swept after a pass that actually wrote, so a degraded result still ages out old rows while a
 *  failed one leaves them: retention dates rows by when they were fetched, and a sweep on the back
 *  of a failed fetch trims exactly the history that fetch was meant to renew. Deletes run in
 *  sequence because SQLite admits one writer. */
export async function applyRetention(
  deps: RetentionDeps,
  market: Market,
  options: RefreshMarketDataOptions
): Promise<void> {
  // Global, not per market: the Fed and CNBC feeds belong to no market and must still age out.
  await drainPages(() =>
    deps.newsArchive.deleteFetchedBefore({
      fetchedBefore: options.now - NEWS_RETENTION_MS,
      limit: RETENTION_DELETE_LIMIT,
      signal: options.signal,
    })
  )

  const retentionMs = resolveRetentionMs([market])
  const fetchedBefore = options.now - retentionMs

  // A market declaring no evidence window has no age at which its rows stop being read, so a zero
  // here means "nothing to derive from", never "delete everything older than now".
  if (retentionMs <= 0 || fetchedBefore <= 0) {
    return
  }

  for (const scope of RETENTION_SCOPES) {
    await drainPages(() =>
      deps.marketDataStore.deleteExpired({
        scope,
        market: options.market,
        fetchedBefore: options.now - retentionMsOf(scope, retentionMs),
        limit: RETENTION_DELETE_LIMIT,
        signal: options.signal,
      })
    )
  }

  // Macro rows are keyed by region, so the market that owns the region owns their cutoff.
  // A second market in the same region trims on its own evidence window and would cut the owner's
  // history short. The day is the calendar day the fetched-at instant falls on.
  if (!market.manifest.ownsRegion) {
    return
  }

  await deps.marketDataStore.deleteMacroRiskBefore({
    region: market.manifest.region,
    beforeDay: market.manifest.calendar.dayAt(fetchedBefore),
    limit: RETENTION_DELETE_LIMIT,
    signal: options.signal,
  })
}
