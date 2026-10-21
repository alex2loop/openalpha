import type { Ticker } from '@/trading/kernel/instrument'
import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketDataRefreshRequest, MarketManifest } from '@/trading/markets/types'
import { createRefreshProgress } from '@/trading/kernel/market/refresh'
import { loadUsMembers } from '@/trading/markets/equity-us/board'
import { US_MARKET_REF } from '@/trading/markets/equity-us/policy'
import { emptyKindResult, toKindResult } from '@/trading/markets/refresh-result'

interface AccountsOptions {
  readonly manifest: MarketManifest
  readonly universe: readonly InstrumentRecord[]
  readonly request: MarketDataRefreshRequest
}

/** One read of the frames answers every board name at once. Without the SEC contact the source is
 *  unconfigured: the kind attempted nothing, so it records no attempt and asks again next time. */
export async function refreshUsAccounts(
  deps: MarketDeps,
  options: AccountsOptions
): Promise<RefreshKindResult> {
  const { manifest, universe, request } = options
  const members = await loadUsMembers(deps, manifest, {
    records: universe,
    asOf: request.asOf,
    now: request.now,
    signal: request.signal,
  })
  const tickers = members.map((member) => member.record.instrument.ticker)

  // No board yet (fundamentals failed or never ran): nothing to ask the frames for.
  if (tickers.length === 0) {
    return emptyKindResult('accounts', 'unavailable', [])
  }

  createRefreshProgress(request.progress, { market: US_MARKET_REF, kind: 'accounts' }, 1)

  const result = await deps.sources.resolve({
    kind: 'accounts',
    context: { market: US_MARKET_REF, tickers, toDay: request.asOf },
    signal: request.signal,
  })

  if (result.kind === 'unavailable') {
    return emptyKindResult('accounts', 'unavailable', result.caveats)
  }

  await deps.marketDataStore.upsertAccounts(result.value, request.signal)

  const filed = new Set<Ticker>(result.value.annual.map((report) => report.instrument.ticker))

  return toKindResult({
    kind: 'accounts',
    successStatus: 'upserted',
    outcomes: tickers.map((ticker) => ({
      instrument: { market: US_MARKET_REF, ticker },
      ...(filed.has(ticker) ? { value: true } : {}),
      provenance: result.provenance,
      caveats: [],
    })),
    recordCount: result.value.annual.length,
    caveats: result.caveats,
  })
}
