import type { InstrumentRef, Region } from '@/trading/kernel/instrument'
import type { AccountsHistory } from '@/trading/kernel/market/annual-accounts'
import type {
  EventsRequest,
  FuturesBasis,
  InstrumentRequest,
  InstrumentStatistics,
  MarketBriefRequest,
  MarketRequest,
  SectorStrengthResult,
} from '@/trading/kernel/market/market-capability'
import type {
  SourceContext,
  SourceKindMap,
  SourceResult,
} from '@/trading/kernel/source/source-result'
import type { SettledBarsPolicy } from '@/trading/markets/bars'
import type { MarketDeps } from '@/trading/markets/deps'
import type { CrossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import type { MarketCapabilities, MarketManifest } from '@/trading/markets/types'
import { available, dedupeProvenance, unavailable } from '@/trading/kernel/source/source-result'
import { settledBars } from '@/trading/markets/bars'
import { QUARTER_GAP_CODES } from '@/trading/markets/equity-vn/accounts/quarter-gaps'
import { buildVnBrief } from '@/trading/markets/equity-vn/brief/compose'
import { runMacroRisk } from '@/trading/markets/equity-vn/evidence/macro-evidence'
import { latestBarProvenance } from '@/trading/markets/equity-vn/evidence/provenance'
import { toSectorMember } from '@/trading/markets/equity-vn/factors/factors'
import { sectorCoveragePct } from '@/trading/markets/equity-vn/factors/sectors'
import {
  BASIS_SESSIONS,
  LIQUIDITY_SESSIONS,
  MINIMUM_SECTOR_COVERAGE_FRACTION,
  VN_EVIDENCE_SESSIONS,
  VN_MARKET_REF,
  VN_MARKET_REGION,
  VN_RECOMMENDATION_SESSIONS,
  VOLATILITY_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import { sourceBars } from '@/trading/markets/equity-vn/refresh/bars'
import { createFlowsCapability } from '@/trading/markets/equity-vn/refresh/flow-capability'
import { refreshMarketData, vnStaleKinds } from '@/trading/markets/equity-vn/refresh/refresh'
import {
  findFrontMonthFuture,
  findIndexInstrument,
  loadUniverse,
} from '@/trading/markets/equity-vn/refresh/universe'
import { runScreen } from '@/trading/markets/equity-vn/screen-capability'
import { buildFuturesBasis } from '@/trading/markets/equity-vn/tape/basis'
import { runOverview } from '@/trading/markets/equity-vn/tape/overview'
import { vnQuote } from '@/trading/markets/equity-vn/tape/quote'
import { realizedVolatility } from '@/trading/markets/timeseries'

/** `quote`, `events`, `news`, and `flows` are pure delegation: this market adds routing, not
 *  transformation. The rest compose. */
export function vnCapabilities(
  deps: MarketDeps,
  manifest: MarketManifest,
  crossSection: CrossSectionCache
): MarketCapabilities {
  return {
    quote: { kind: 'quote', run: (request) => vnQuote(deps, manifest, request) },
    bars: {
      kind: 'bars',
      run: (request) =>
        settledBars(deps, request, {
          calendar: manifest.calendar,
          defaultSessions: VN_EVIDENCE_SESSIONS,
          fetch: (window) => sourceBars(deps, request, window),
        } satisfies SettledBarsPolicy),
    },
    overview: {
      kind: 'overview',
      run: (request) => runOverview({ deps, manifest, crossSection, request }),
    },
    events: { kind: 'events', run: (request) => runEvents(deps, request) },
    news: {
      kind: 'news',
      run: (request) =>
        deps.sources.resolve({
          kind: 'news',
          context: newsContext(request),
          signal: request.signal,
        }),
    },
    flows: createFlowsCapability(deps, manifest, crossSection),
    tradeSides: { kind: 'tradeSides', run: (request) => runTradeSides(deps, request) },
    recommendations: {
      kind: 'recommendations',
      run: (request) => runRecommendations(deps, manifest, request),
    },
    screen: {
      kind: 'screen',
      run: (request) =>
        runScreen(crossSection, request, deps.config.defaultRegion !== VN_MARKET_REGION),
    },
    sectors: { kind: 'sectors', run: (request) => runSectors(crossSection, request) },
    statistics: { kind: 'statistics', run: (request) => runStatistics(crossSection, request) },
    accounts: { kind: 'accounts', run: (request) => runAccounts(crossSection, request) },
    macroRisk: {
      kind: 'macroRisk',
      run: (request) => runMacroRisk({ deps, crossSection, calendar: manifest.calendar, request }),
    },
    basis: { kind: 'basis', run: (request) => runBasis(deps, manifest, request) },
    refresh: {
      kind: 'refresh',
      run: (request) => refreshMarketData({ deps, manifest, crossSection, request }),
    },
    staleKinds: {
      kind: 'staleKinds',
      run: (request) => vnStaleKinds(manifest.calendar, request),
    },
    ...briefCapability(deps, manifest, crossSection),
  }
}

/** A market with no brief seam bound publishes no brief, rather than one that throws. */
function briefCapability(
  deps: MarketDeps,
  manifest: MarketManifest,
  crossSection: CrossSectionCache
): Pick<MarketCapabilities, 'brief'> {
  const services = deps.briefServices

  if (services === undefined) {
    return {}
  }

  return {
    brief: {
      kind: 'brief',
      run: (request: MarketBriefRequest) =>
        buildVnBrief({
          deps,
          services,
          request,
          calendar: manifest.calendar,
          cross: () => crossSection.get(request.asOf, request.signal),
          crossAt: (day) => crossSection.get(day, request.signal),
        }),
    },
  }
}

/** A ranking over a partly classified universe would wear the market's authority while covering a
 *  fraction of it, so below the coverage floor the board is empty and the caveat says why. */
async function runSectors(
  cache: CrossSectionCache,
  request: MarketRequest
): Promise<SectorStrengthResult> {
  const cross = await cache.get(request.asOf, request.signal)
  const coverage = sectorCoveragePct(cross.names.map(toSectorMember))

  if (cross.sectors.length === 0 || coverage < MINIMUM_SECTOR_COVERAGE_FRACTION) {
    return {
      asOf: request.asOf,
      sectors: [],
      provenance: [],
      caveats: [{ code: 'market-data.no-coverage', detail: { coverage } }],
    }
  }

  return {
    asOf: request.asOf,
    sectors: cross.sectors,
    provenance: dedupeProvenance(cross.names.flatMap(latestBarProvenance)),
    caveats: [],
  }
}

/** Both fields come from the pass the screen already made, so a sizing question costs no provider
 *  read. A name outside the ranked universe has no measured window — absent, never a zero. */
async function runStatistics(
  cache: CrossSectionCache,
  request: InstrumentRequest
): Promise<SourceResult<InstrumentStatistics>> {
  const cross = await cache.get(request.asOf, request.signal)
  const evidence = cross.byTicker.get(request.instrument.ticker)

  if (evidence === undefined) {
    return unavailable('unsupported', [])
  }

  const volatilityDaily = realizedVolatility(evidence.closes, VOLATILITY_SESSIONS)

  return available(
    {
      instrument: request.instrument,
      asOf: request.asOf,
      sessions: LIQUIDITY_SESSIONS,
      ...(evidence.turnover === undefined ? {} : { averageDailyTurnover: evidence.turnover }),
      ...(volatilityDaily === undefined ? {} : { volatilityDaily }),
    },
    latestBarProvenance(evidence)
  )
}

/** Read off the board pass, so asking costs no provider read. A name whose reports were never
 *  fetched has none to read: absent, never an empty history. */
async function runAccounts(
  cache: CrossSectionCache,
  request: InstrumentRequest
): Promise<SourceResult<AccountsHistory>> {
  const cross = await cache.get(request.asOf, request.signal)
  const history = cross.accounts.get(request.instrument.ticker)?.history

  if (history === undefined) {
    return unavailable('empty', [])
  }

  return available(
    history,
    [{ sourceId: history.sourceId, fetchedAt: history.fetchedAt, freshness: 'cached' }],
    history.caveats.filter((caveat) => QUARTER_GAP_CODES.has(caveat.code))
  )
}

/** Research, not execution: a bearish VN read has no short leg, because single-stock shorting is
 *  unsupported here. The basis states what the futures market pays relative to spot and nothing
 *  in this market creates a position. */
async function runBasis(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: MarketRequest
): Promise<SourceResult<FuturesBasis>> {
  const universe = await loadUniverse(deps, { signal: request.signal })
  const index = findIndexInstrument(universe)
  const future = findFrontMonthFuture(universe)

  if (index === undefined || future === undefined) {
    return unavailable('stale', [])
  }

  const fromDay = manifest.calendar.addTradingDays(request.asOf, -BASIS_SESSIONS)
  const [spotBars, futureBars] = await Promise.all([
    deps.marketDataStore.listBars({
      instrument: index.instrument,
      fromDay,
      toDay: request.asOf,
      signal: request.signal,
    }),
    deps.marketDataStore.listBars({
      instrument: future.instrument,
      fromDay,
      toDay: request.asOf,
      signal: request.signal,
    }),
  ])

  return buildFuturesBasis({
    spot: spotBars.map((bar) => bar.candle),
    future: futureBars.map((bar) => bar.candle),
    contract: {
      code: future.instrument.ticker,
      ...(future.expiresOn === undefined ? {} : { expiry: future.expiresOn }),
    },
    provenance: [],
  })
}

/** Delegation, like `passthrough`, but the recommendation route is dated: a stale analyst view is
 *  worse than none, so the window travels on the context. */
function runRecommendations(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: InstrumentRequest
): Promise<SourceResult<SourceKindMap['recommendations']>> {
  return deps.sources.resolve({
    kind: 'recommendations',
    context: {
      market: VN_MARKET_REF,
      instrument: request.instrument,
      fromDay: manifest.calendar.addTradingDays(request.asOf, -VN_RECOMMENDATION_SESSIONS),
      toDay: request.asOf,
    },
    signal: request.signal,
  })
}

/** Settled sessions only: `toDay` is the day being asked about, and the adapter reconstructs that
 *  session whole or reports nothing. */
function runTradeSides(
  deps: MarketDeps,
  request: InstrumentRequest
): Promise<SourceResult<SourceKindMap['tradeSides']>> {
  return deps.sources.resolve({
    kind: 'tradeSides',
    context: { market: VN_MARKET_REF, instrument: request.instrument, toDay: request.asOf },
    signal: request.signal,
  })
}

/** Dated like flows: the adapter filters on `exrightDate >= fromDay`, so the caller's own range
 *  start travels on the context rather than being rediscovered here. */
function runEvents(
  deps: MarketDeps,
  request: EventsRequest
): Promise<SourceResult<SourceKindMap['events']>> {
  return deps.sources.resolve({
    kind: 'events',
    context: {
      market: VN_MARKET_REF,
      instrument: request.instrument,
      fromDay: request.fromDay,
      toDay: request.asOf,
    },
    signal: request.signal,
  })
}

interface NewsScope {
  readonly instrument?: InstrumentRef
  readonly region?: Region
  readonly limit: number
}

function newsContext(scope: NewsScope): SourceContext {
  return {
    market: VN_MARKET_REF,
    region: scope.region ?? VN_MARKET_REGION,
    limit: scope.limit,
    ...(scope.instrument === undefined ? {} : { instrument: scope.instrument }),
  }
}
