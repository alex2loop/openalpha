import type { MarketDescription } from '@/trading/features/market-data/types'
import type { QuoteConvention } from '@/trading/render/money'
import type { MarketView, TradingHost, TradingHostDeps } from '@/trading/wiring/host/types'
import { renderDeclaredValue } from '@/trading/render/format'
import { renderMarketName, renderRegionName } from '@/trading/render/tool-detail'
import { bounded, profileOf, resolveRegion, scoped, scopedSlow } from '@/trading/wiring/host/scope'

export type MarketMethods = Pick<
  TradingHost,
  | 'getQuotes'
  | 'getOhlcv'
  | 'getEvents'
  | 'getNews'
  | 'searchInstruments'
  | 'getSuggestionCard'
  | 'screen'
  | 'getOverview'
  | 'getMacroRisk'
  | 'describeMarkets'
>

type SeriesMethods = Pick<MarketMethods, 'getOhlcv' | 'getEvents'>

type PriceMethods = Pick<
  MarketMethods,
  'getQuotes' | 'getNews' | 'searchInstruments' | 'getSuggestionCard' | 'describeMarkets'
>

/** One name over a day range. */
function seriesMethods(deps: TradingHostDeps): SeriesMethods {
  return {
    getOhlcv: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.marketData.bars({
          ticker: request.instrument.ticker,
          market: request.instrument.market,
          fromDay: request.fromDay,
          toDay: request.toDay,
          now: scope.now,
          signal: scope.signal,
        })
      ),

    getEvents: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.marketData.events({
          ticker: request.instrument.ticker,
          market: request.instrument.market,
          fromDay: request.fromDay,
          toDay: request.toDay,
          now: scope.now,
          signal: scope.signal,
        })
      ),
  }
}

function describedMarket(
  deps: TradingHostDeps,
  market: MarketDescription,
  convention: QuoteConvention
): MarketView {
  const locale = deps.defaultLocale

  return {
    ...market,
    ...convention,
    label: renderMarketName(locale, market.market),
    segmentLabel: renderDeclaredValue(locale, `trading.segment.${market.segment}`),
    regionLabel: renderRegionName(locale, market.region),
  }
}

function priceMethods(deps: TradingHostDeps): PriceMethods {
  const { marketData } = deps.services

  return {
    // How each market prints a price, so an app prints it the way the CLI does, and its names.
    describeMarkets: () => ({
      homeRegion: deps.services.defaultRegion,
      markets: marketData.describeMarkets().flatMap((market) => {
        const convention = marketData.quoteConvention(market.market)

        return convention === undefined ? [] : [describedMarket(deps, market, convention)]
      }),
    }),

    getQuotes: (signal) =>
      scoped(deps, signal, async (scope) => {
        const profile = await profileOf(deps, scope)

        return deps.services.marketData.quoteBoard({
          instruments: profile.watchlist,
          signal: scope.signal,
        })
      }),

    getNews: (request) =>
      scoped(deps, request.signal, async (scope) => {
        const region = resolveRegion(deps, request.region)
        const result = await deps.services.marketData.curatedNews({
          region,
          limit: bounded(request.limit, deps.limits.maximumNewsItems),
          now: scope.now,
          signal: scope.signal,
        })

        return { region, result }
      }),

    searchInstruments: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.marketData.searchInstruments({
          query: request.query,
          limit: bounded(request.limit, deps.limits.maximumSearchItems),
          signal: scope.signal,
        })
      ),

    getSuggestionCard: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.suggestionCards.card({
          suggestionId: request.suggestionId,
          locale: deps.defaultLocale,
          signal: scope.signal,
        })
      ),
  }
}

/** The whole-market reads: each may refresh a cold market first, so each gets the slow ceiling. */
function boardMethods(
  deps: TradingHostDeps
): Omit<MarketMethods, keyof PriceMethods | keyof SeriesMethods> {
  return {
    // An unregistered market is refused inside the service, the one holder of the registry.
    screen: (request) =>
      scopedSlow(deps, request.signal, async (scope) => {
        const kind =
          request.instrumentKind === undefined ? {} : { instrumentKind: request.instrumentKind }
        const view = await deps.services.marketData.screen({
          market: request.market,
          limit: bounded(request.limit, deps.limits.maximumScreenCandidates),
          ...kind,
          now: scope.now,
          signal: scope.signal,
        })
        const card = deps.services.appViews.screen({
          market: request.market,
          ...kind,
          view,
          locale: deps.defaultLocale,
        })

        return { view, card }
      }),

    getOverview: (signal) =>
      scopedSlow(deps, signal, (scope) =>
        deps.services.marketData.overview({ now: scope.now, signal: scope.signal })
      ),

    // The overview leaves the operator's own region without its regime; this read is where it lives.
    getMacroRisk: (request) =>
      scopedSlow(deps, request.signal, async (scope) => {
        const region = resolveRegion(deps, request.region)
        const macro = await deps.services.appViews.macro({
          region,
          locale: deps.defaultLocale,
          now: scope.now,
          signal: scope.signal,
        })

        return { region, ...macro }
      }),
  }
}

export function marketMethods(deps: TradingHostDeps): MarketMethods {
  return { ...seriesMethods(deps), ...priceMethods(deps), ...boardMethods(deps) }
}
