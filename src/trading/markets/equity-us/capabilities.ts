import type {
  InstrumentRequest,
  InstrumentStatistics,
  MarketBriefRequest,
} from '@/trading/kernel/market/market-capability'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { UsBoardCache } from '@/trading/markets/equity-us/board'
import type { MarketCapabilities, MarketManifest } from '@/trading/markets/types'
import { available, unavailable } from '@/trading/kernel/source/source-result'
import { runUsAccounts } from '@/trading/markets/equity-us/accounts'
import { runUsBars } from '@/trading/markets/equity-us/bars'
import { buildUsBrief, US_BRIEF_HOME } from '@/trading/markets/equity-us/brief/compose'
import { runUsEvents } from '@/trading/markets/equity-us/events'
import { runUsNews } from '@/trading/markets/equity-us/news'
import { runUsOverview } from '@/trading/markets/equity-us/overview'
import {
  US_EQUITY_MACRO_DRIVERS,
  US_LIQUIDITY_SESSIONS,
  US_VOLATILITY_SESSIONS,
} from '@/trading/markets/equity-us/policy'
import { runUsQuote } from '@/trading/markets/equity-us/quote'
import { previousUsScoreRegime } from '@/trading/markets/equity-us/refresh/macro'
import { refreshUsMarket, usStaleKinds } from '@/trading/markets/equity-us/refresh/refresh'
import { runUsScreen } from '@/trading/markets/equity-us/screen-capability'
import { resolveMacroRisk } from '@/trading/markets/macro'
import { statisticsFromCandles, statisticsSessions } from '@/trading/markets/statistics'

const STATISTICS_SESSIONS = statisticsSessions(US_LIQUIDITY_SESSIONS, US_VOLATILITY_SESSIONS)

export function usCapabilities(
  deps: MarketDeps,
  manifest: MarketManifest,
  board: UsBoardCache
): MarketCapabilities {
  return {
    ...priceCapabilities(deps, manifest),
    ...newsCapabilities(deps, manifest),
    ...screenCapabilities(board),
    ...accountsCapabilities(deps, board),
    ...overviewCapabilities(deps, manifest, board),
    ...refreshCapabilities(deps, manifest, board),
    ...briefCapability(deps, manifest, board),
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

function newsCapabilities(
  deps: MarketDeps,
  manifest: MarketManifest
): Pick<MarketCapabilities, 'news' | 'macroRisk'> {
  return {
    news: { kind: 'news', run: (request) => runUsNews(deps, request) },
    macroRisk: {
      kind: 'macroRisk',
      run: async (request) => {
        const previous = await previousUsScoreRegime({
          deps,
          manifest,
          asOf: request.asOf,
          signal: request.signal,
        })

        return resolveMacroRisk(deps, request, { policy: US_EQUITY_MACRO_DRIVERS, ...previous })
      },
    },
  }
}

function refreshCapabilities(
  deps: MarketDeps,
  manifest: MarketManifest,
  board: UsBoardCache
): Pick<MarketCapabilities, 'refresh' | 'staleKinds'> {
  return {
    refresh: {
      kind: 'refresh',
      run: (request) => refreshUsMarket({ deps, manifest, board, request }),
    },
    staleKinds: { kind: 'staleKinds', run: (request) => usStaleKinds(manifest.calendar, request) },
  }
}

function accountsCapabilities(
  deps: MarketDeps,
  board: UsBoardCache
): Pick<MarketCapabilities, 'accounts' | 'events'> {
  return {
    accounts: { kind: 'accounts', run: (request) => runUsAccounts(board, request) },
    events: { kind: 'events', run: (request) => runUsEvents(deps, request) },
  }
}

/** A market with no brief seam bound publishes no brief, rather than one that throws. */
function briefCapability(
  deps: MarketDeps,
  manifest: MarketManifest,
  board: UsBoardCache
): Pick<MarketCapabilities, 'brief'> {
  const services = deps.briefServices

  if (services === undefined) {
    return {}
  }

  return {
    brief: {
      kind: 'brief',
      run: (request: MarketBriefRequest) =>
        buildUsBrief({
          deps,
          services,
          request,
          calendar: manifest.calendar,
          home: US_BRIEF_HOME,
          board: () => board.get(request.asOf, request.signal),
          boardAt: (day) => board.get(day, request.signal),
        }),
    },
  }
}

function screenCapabilities(board: UsBoardCache): Pick<MarketCapabilities, 'screen'> {
  return { screen: { kind: 'screen', run: (request) => runUsScreen(board, request) } }
}

function overviewCapabilities(
  deps: MarketDeps,
  manifest: MarketManifest,
  board: UsBoardCache
): Pick<MarketCapabilities, 'overview'> {
  return {
    overview: {
      kind: 'overview',
      run: (request) => runUsOverview({ deps, manifest, board, request }),
    },
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
    liquiditySessions: US_LIQUIDITY_SESSIONS,
    volatilitySessions: US_VOLATILITY_SESSIONS,
  })

  return statistics === null
    ? unavailable('unsupported', [])
    : available(statistics, bars.provenance, bars.caveats)
}
