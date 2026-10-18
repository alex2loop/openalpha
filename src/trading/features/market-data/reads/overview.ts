import type { MarketDataRunDeps } from '@/trading/features/market-data/market-data-run'
import type {
  MarketDataMarketRequest,
  MarketDataPerMarketRequest,
} from '@/trading/features/market-data/types'
import type { MarketDataOverview } from '@/trading/kernel/market/market-overview'
import type { Market } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import {
  buildEnsureOptions,
  requestedMarkets,
  requireMarket,
} from '@/trading/features/market-data/market-data-run'
import { settledEvidenceCaveats } from '@/trading/features/market-data/reads/freshness'
import { segmentMacroOf } from '@/trading/features/market-data/reads/regime'
import { resolveDay } from '@/trading/features/market-data/resolve'
import { failedOverview, unsupportedOverview } from '@/trading/features/market-data/unsupported'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { sessionPhase } from '@/trading/markets/calendar'

/** The requested markets, together: each answers for itself, so one that fails degrades to its own
 *  caveats rather than emptying the rest. */
export function runOverviews(
  deps: MarketDataRunDeps,
  options: MarketDataPerMarketRequest
): Promise<readonly MarketDataOverview[]> {
  return Promise.all(
    requestedMarkets(deps.markets, options).map((market) =>
      runIsolatedOverview(deps, market, options)
    )
  )
}

async function runIsolatedOverview(
  deps: MarketDataRunDeps,
  market: Market,
  options: MarketDataPerMarketRequest
): Promise<MarketDataOverview> {
  try {
    return await runOverview(deps, { ...options, market: market.manifest.id })
  } catch (err: unknown) {
    if (isAbortError(err) || options.signal.aborted) {
      throw err
    }

    deps.logger.warn('trading.market_overview_failed', {
      market: market.manifest.id,
      err: formatErrForLog(err),
    })

    return failedOverview(market, resolveDay(market, options.now))
  }
}

/** The three stored-evidence reads whose result carries one flat caveat list, so what the
 *  on-demand refresh reported travels with the answer. */
async function runOverview(
  deps: MarketDataRunDeps,
  options: MarketDataMarketRequest
): Promise<MarketDataOverview> {
  const market = requireMarket(deps, options.market)
  const asOf = resolveDay(market, options.now)
  const ensured = await deps.ensure(buildEnsureOptions(options.market, options))
  const macro = await segmentMacroOf(market, {
    now: options.now,
    signal: options.signal,
    headlineRegion: deps.config.defaultRegion,
  })
  const result = await market.capabilities.overview?.run({
    asOf,
    now: options.now,
    signal: options.signal,
  })
  const overview =
    result === undefined
      ? unsupportedOverview(market, asOf)
      : {
          ...result,
          caveats: dedupeCaveats([
            ...result.caveats,
            ...ensured,
            ...(macro?.caveats ?? []),
            ...settledEvidenceCaveats(market, options.now),
          ]),
        }

  const calendar = market.manifest.calendar

  return {
    ...overview,
    ...(macro?.kind === 'available' ? { macro: macro.value } : {}),
    sessionState: calendar.sessionState(options.now),
    sessionPhase: sessionPhase(calendar, options.now),
  }
}
