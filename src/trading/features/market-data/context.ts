import type { MarketDataRunDeps } from '@/trading/features/market-data/market-data-run'
import type {
  MarketDataCuratedNewsRequest,
  MarketDataDayRangeRequest,
  MarketDataFlowsRequest,
  MarketDataHeadlinesRequest,
  MarketDataNewsRequest,
  MarketDataRegionRequest,
} from '@/trading/features/market-data/types'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { FuturesBasis } from '@/trading/kernel/market/market-capability'
import type { FlowSnapshot, NewsItem } from '@/trading/kernel/market/market-data'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type {
  MarketNews,
  SourceResult,
  SourceUnavailable,
} from '@/trading/kernel/source/source-result'
import type { Market, SourceRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import {
  buildEnsureOptions,
  requestedMarkets,
  requireMarket,
  withinRange,
} from '@/trading/features/market-data/market-data-run'
import {
  resolveDay,
  resolveInstrument,
  unsupportedCapability,
} from '@/trading/features/market-data/resolve'
import { available } from '@/trading/kernel/source/source-result'
import { resolveSettledDay } from '@/trading/markets/calendar'
import { rankHeadlines } from '@/trading/markets/news'

export async function runFlows(
  deps: MarketDataRunDeps,
  options: MarketDataFlowsRequest
): Promise<SourceResult<readonly FlowSnapshot[]>> {
  const scope = await resolveFlowsScope(deps, options)

  if (scope.kind === 'unresolved') {
    return scope.result
  }

  const result = await scope.market.capabilities.flows?.run({
    ...(scope.instrument === undefined ? {} : { instrument: scope.instrument }),
    asOf: scope.instrument === undefined ? resolveDay(scope.market, options.now) : options.toDay,
    now: options.now,
    signal: options.signal,
  })

  return result === undefined
    ? unsupportedCapability()
    : withinRange(result, options, (flow) => flow.at)
}

type FlowsScope =
  | { readonly kind: 'resolved'; readonly market: Market; readonly instrument?: InstrumentRef }
  | { readonly kind: 'unresolved'; readonly result: SourceUnavailable }

/** No ticker asks for the market's own desk totals; like the basis, the one market that publishes
 *  flows is the whole selector. */
function resolveFlowsScope(
  deps: MarketDataRunDeps,
  options: MarketDataFlowsRequest
): Promise<FlowsScope> {
  if (options.ticker !== undefined) {
    return resolveInstrument(deps.markets, {
      ticker: options.ticker,
      ...(options.market === undefined ? {} : { market: options.market }),
      signal: options.signal,
    })
  }

  const market = deps.markets.list().find((entry) => entry.capabilities.flows !== undefined)

  return Promise.resolve(
    market === undefined
      ? { kind: 'unresolved', result: unsupportedCapability() }
      : { kind: 'resolved', market }
  )
}

export async function runNews(
  deps: MarketDataRunDeps,
  options: MarketDataNewsRequest
): Promise<SourceResult<readonly NewsItem[]>> {
  // Neither a ticker nor a market names a scope, so this is the region's whole tape - the same read
  // `curatedNews` serves, and the same reason it must not resolve to one market by registration
  // order.
  if (options.ticker === undefined && options.market === undefined) {
    return runCuratedNews(deps, { ...options, region: options.region ?? deps.config.defaultRegion })
  }

  const scope = await resolveNewsScope(deps, options)

  if (scope === null) {
    return unsupportedCapability()
  }

  return (
    (await scope.market.capabilities.news?.run({
      ...(scope.instrument === undefined ? {} : { instrument: scope.instrument }),
      ...(options.region === undefined ? {} : { region: options.region }),
      limit: options.limit,
      asOf: resolveDay(scope.market, options.now),
      now: options.now,
      signal: options.signal,
    })) ?? unsupportedCapability()
  )
}

/** A tape that prices every market in the brief and belongs to none: the macro releases the
 *  drivers are computed from by default, or a named feed scope such as the global economy wire.
 *  Neither market nor region, which is why it takes the registry directly rather than reaching one
 *  through a market's capability. */
export async function runTapeNews(
  sources: SourceRegistry,
  options: MarketDataHeadlinesRequest,
  feedScope?: string
): Promise<SourceResult<readonly NewsItem[]>> {
  const result = await sources.resolve({
    kind: 'news',
    context: { ...(feedScope === undefined ? {} : { feedScope }), limit: options.limit },
    signal: options.signal,
  })

  if (result.kind === 'unavailable') {
    return result
  }

  return available(
    rankHeadlines(result.value, { now: options.now, limit: options.limit }),
    result.provenance,
    result.caveats
  )
}

/** Every registered market that publishes news, mirroring `runOverviews`. A market that publishes
 *  none is absent rather than unsupported: the brief has no section to render for it. */
export function runNewsPerMarket(
  deps: MarketDataRunDeps,
  options: MarketDataHeadlinesRequest
): Promise<readonly MarketNews[]> {
  return Promise.all(
    requestedMarkets(deps.markets, options)
      .filter((market) => market.capabilities.news !== undefined)
      .map(async (market) => ({
        market: market.manifest.id,
        result: await runMarketNews(market, options),
      }))
  )
}

/** Every news-publishing market in the region, merged. Not the region owner alone: a region holds
 *  more than one publisher, and picking one made the answer depend on registration order. */
export async function runCuratedNews(
  deps: MarketDataRunDeps,
  options: MarketDataCuratedNewsRequest
): Promise<SourceResult<readonly NewsItem[]>> {
  const markets = deps.markets
    .list()
    .filter(
      (market) =>
        market.manifest.region === options.region && market.capabilities.news !== undefined
    )

  if (markets.length === 0) {
    return unsupportedCapability()
  }

  const results = await Promise.all(markets.map((market) => runMarketNews(market, options)))

  return mergeNews(results, options)
}

async function runMarketNews(
  market: Market,
  options: MarketDataHeadlinesRequest
): Promise<SourceResult<readonly NewsItem[]>> {
  const result = await market.capabilities.news?.run({
    region: market.manifest.region,
    limit: options.limit,
    asOf: resolveDay(market, options.now),
    now: options.now,
    signal: options.signal,
  })

  if (result === undefined || result.kind === 'unavailable') {
    return result ?? unsupportedCapability()
  }

  return available(
    rankHeadlines(result.value, { now: options.now, limit: options.limit }),
    result.provenance,
    result.caveats
  )
}

/** Unavailable only when every market failed: one silent feed degrades the read, it does not end
 *  it. The caveats travel either way, so the reader is told which one went quiet. */
function mergeNews(
  results: readonly SourceResult<readonly NewsItem[]>[],
  options: MarketDataCuratedNewsRequest
): SourceResult<readonly NewsItem[]> {
  const caveats = results.flatMap((result) => result.caveats)
  const readable = results.filter((result) => result.kind === 'available')

  if (readable.length === 0) {
    return unsupportedCapability(caveats)
  }

  return available(
    rankHeadlines(
      readable.flatMap((result) => result.value),
      { now: options.now, limit: options.limit }
    ),
    readable.flatMap((result) => result.provenance),
    caveats
  )
}

/** The region's own market answers, never whichever sibling registered first: a region holds several
 *  markets and only its owner publishes the composite that sizes the region's sleeves. Dated by the
 *  settled session the refresh files the snapshot under, so a derived read and a stored one never
 *  date one composite two ways — the calendar day is a weekend often enough to date it to no
 *  session at all. */
export async function runMacroRisk(
  deps: MarketDataRunDeps,
  options: MarketDataRegionRequest
): Promise<SourceResult<MacroRiskView>> {
  const market = deps.markets.regionOwner(options.region)

  if (market === null || market.capabilities.macroRisk === undefined) {
    return unsupportedCapability()
  }

  await deps.ensure(buildEnsureOptions(market.manifest.id, options))

  return market.capabilities.macroRisk.run({
    region: options.region,
    asOf: resolveSettledDay(market.manifest.calendar, options.now),
    now: options.now,
    signal: options.signal,
  })
}

/** Exactly one registered market implements the basis, so the range is the whole selector and no
 *  market ref is needed. */
export async function runBasis(
  deps: MarketDataRunDeps,
  options: MarketDataDayRangeRequest
): Promise<SourceResult<FuturesBasis>> {
  const market = deps.markets.list().find((entry) => entry.capabilities.basis !== undefined)

  if (market === undefined) {
    return unsupportedCapability()
  }

  await deps.ensure(buildEnsureOptions(market.manifest.id, options))

  return (
    (await market.capabilities.basis?.run({
      asOf: options.toDay,
      now: options.now,
      signal: options.signal,
    })) ?? unsupportedCapability()
  )
}

/** News narrows from the most specific scope the caller supplied: an instrument, then an explicit
 *  market, and nothing else - `runNews` routes the regionless, marketless case to `runCuratedNews`
 *  before this is ever called. */
async function resolveNewsScope(
  deps: MarketDataRunDeps,
  options: MarketDataNewsRequest
): Promise<NewsScope | null> {
  if (options.ticker !== undefined) {
    const resolved = await resolveInstrument(deps.markets, {
      ticker: options.ticker,
      ...(options.market === undefined ? {} : { market: options.market }),
      signal: options.signal,
    })

    return resolved.kind === 'resolved'
      ? { market: resolved.market, instrument: resolved.instrument }
      : null
  }

  if (options.market === undefined) {
    throw new ValidationError(
      'news request without a ticker or market must be routed through runCuratedNews'
    )
  }

  return { market: requireMarket(deps, options.market) }
}

interface NewsScope {
  readonly market: Market
  readonly instrument?: InstrumentRef
}
