import type {
  InstrumentRequest,
  InstrumentStatistics,
} from '@/trading/kernel/market/market-capability'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketCapabilities, MarketManifest } from '@/trading/markets/types'
import { available, unavailable } from '@/trading/kernel/source/source-result'
import { runUsBars } from '@/trading/markets/equity-us/bars'
import { runUsNews } from '@/trading/markets/equity-us/news'
import {
  US_STATISTICS_LIQUIDITY_SESSIONS,
  US_STATISTICS_VOLATILITY_SESSIONS,
} from '@/trading/markets/equity-us/policy'
import { runUsQuote } from '@/trading/markets/equity-us/quote'
import { refreshUsMarket, usStaleKinds } from '@/trading/markets/equity-us/refresh/refresh'
import { resolveMacroRisk } from '@/trading/markets/macro'
import { statisticsFromCandles, statisticsSessions } from '@/trading/markets/statistics'

const STATISTICS_SESSIONS = statisticsSessions(
  US_STATISTICS_LIQUIDITY_SESSIONS,
  US_STATISTICS_VOLATILITY_SESSIONS
)

export function usCapabilities(deps: MarketDeps, manifest: MarketManifest): MarketCapabilities {
  return {
    ...priceCapabilities(deps, manifest),
    ...newsCapabilities(deps),
    ...refreshCapabilities(deps, manifest),
  }
}

function priceCapabilities(
  deps: MarketDeps,
  manifest: MarketManifest
): Pick<MarketCapabilities, 'quote' | 'bars' | 'statistics'> {
  return {
    quote: { kind: 'quote', run: (request) => runUsQuote(deps, manifest, request) },
    bars: { kind: 'bars', run: (request) => runUsBars(deps, manifest, request) },
    statistics: { kind: 'statistics', run: (request) => runUsStatistics(deps, manifest, request) },
  }
}

function newsCapabilities(deps: MarketDeps): Pick<MarketCapabilities, 'news' | 'macroRisk'> {
  return {
    news: { kind: 'news', run: (request) => runUsNews(deps, request) },
    macroRisk: { kind: 'macroRisk', run: (request) => resolveMacroRisk(deps, request) },
  }
}

function refreshCapabilities(
  deps: MarketDeps,
  manifest: MarketManifest
): Pick<MarketCapabilities, 'refresh' | 'staleKinds'> {
  return {
    refresh: { kind: 'refresh', run: (request) => refreshUsMarket(deps, manifest, request) },
    staleKinds: { kind: 'staleKinds', run: (request) => usStaleKinds(request) },
  }
}

async function runUsStatistics(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: InstrumentRequest
): Promise<SourceResult<InstrumentStatistics>> {
  const bars = await runUsBars(deps, manifest, { ...request, sessions: STATISTICS_SESSIONS })

  if (bars.kind === 'unavailable') {
    return bars
  }

  const statistics = statisticsFromCandles(bars.value, {
    instrument: request.instrument,
    asOf: request.asOf,
    liquiditySessions: US_STATISTICS_LIQUIDITY_SESSIONS,
    volatilitySessions: US_STATISTICS_VOLATILITY_SESSIONS,
  })

  return statistics === null
    ? unavailable('unsupported', [])
    : available(statistics, bars.provenance, bars.caveats)
}
