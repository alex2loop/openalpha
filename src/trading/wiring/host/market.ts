import type { Locale } from '@/core/types/locale'
import type { MarketDescription } from '@/trading/features/market-data/types'
import type { SourceSummary } from '@/trading/kernel/source/source-result'
import type { QuoteConvention } from '@/trading/render/money'
import type { SourceStatus } from '@/trading/wiring/host/market-types'
import type { TradingHost, TradingHostDeps } from '@/trading/wiring/host/types'
import type { MarketView } from '@/trading/wiring/host/view-types'
import { renderDeclaredValue, renderProvidedValue } from '@/trading/render/format'
import { renderMarketName, renderRegionName } from '@/trading/render/tool-detail'
import { bounded, profileOf, resolveRegion, scoped, scopedSlow } from '@/trading/wiring/host/scope'

const LINE_BREAK = '\n'

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
  | 'readMarketSession'
  | 'describeMarkets'
  | 'getSectors'
  | 'getIndexContributors'
  | 'getIndexValuation'
  | 'listSources'
>

type SeriesMethods = Pick<MarketMethods, 'getOhlcv' | 'getEvents'>

type ListingMethods = Pick<MarketMethods, 'getSectors' | 'listSources'>

type IndexMethods = Pick<MarketMethods, 'getIndexContributors' | 'getIndexValuation'>

type SessionMethods = Pick<MarketMethods, 'readMarketSession'>

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
  { convention, now }: { readonly convention: QuoteConvention; readonly now: number }
): MarketView {
  const locale = deps.defaultLocale
  const day = deps.services.marketData.marketDay(market.market, now)

  return {
    ...market,
    ...convention,
    ...(day === undefined ? {} : { day }),
    label: renderMarketName(locale, market.market),
    segmentLabel: renderDeclaredValue(locale, `trading.segment.${market.segment}`),
    regionLabel: renderRegionName(locale, market.region),
  }
}

function toSourceStatus(locale: Locale, summary: SourceSummary): SourceStatus {
  const { lastFailureCode: code } = summary

  return {
    ...summary,
    ...(code === undefined
      ? {}
      : { failure: renderProvidedValue(locale, `trading.source.failure.${code}`, code) }),
  }
}

function priceMethods(deps: TradingHostDeps): PriceMethods {
  const { marketData } = deps.services

  return {
    // How each market prints a price, so an app prints it the way the CLI does, and its names.
    describeMarkets: (now) => ({
      homeRegion: deps.services.defaultRegion,
      markets: marketData.describeMarkets().flatMap((market) => {
        const convention = marketData.quoteConvention(market.market)

        return convention === undefined ? [] : [describedMarket(deps, market, { convention, now })]
      }),
    }),

    getQuotes: (signal, instrument) =>
      scoped(deps, signal, async (scope) => {
        return deps.services.marketData.quoteBoard({
          instruments:
            instrument === undefined ? (await profileOf(deps, scope)).watchlist : [instrument],
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

/** The lists an app draws a table from: one market's sectors, strongest first, and the data
 *  sources, each named in the operator's language. */
function listingMethods(deps: TradingHostDeps): ListingMethods {
  return {
    // A transport code is an internal name; the operator reads the catalog's words for it.
    listSources: () =>
      deps.services.marketData
        .listSources()
        .map((summary) => toSourceStatus(deps.defaultLocale, summary)),

    getSectors: (request) =>
      scopedSlow(deps, request.signal, async (scope) => {
        const { asOf, sectors, caveats } = await deps.services.marketData.sectors({
          market: request.market,
          now: scope.now,
          signal: scope.signal,
        })

        return {
          asOf,
          sectors: sectors.map((sector) => ({
            ...sector,
            label: renderProvidedValue(
              deps.defaultLocale,
              `trading.sector.${sector.sector}`,
              sector.sector
            ),
          })),
          caveats,
        }
      }),
  }
}

/** An index's contributors and valuation. The valuation is stored and the contributors held, so
 *  neither waits on a provider for long: the ordinary ceiling applies. */
function indexMethods(deps: TradingHostDeps): IndexMethods {
  return {
    getIndexContributors: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.marketData.indexContributors({
          market: request.market,
          index: request.index,
          now: scope.now,
          signal: scope.signal,
        })
      ),

    getIndexValuation: (request) =>
      scoped(deps, request.signal, (scope) =>
        deps.services.marketData.indexValuation({
          market: request.market,
          index: request.index,
          now: scope.now,
          signal: scope.signal,
        })
      ),
  }
}

/** What `/market` prints: it reads the sources for a whole session, so it gets the slow ceiling. */
function sessionMethods(deps: TradingHostDeps): SessionMethods {
  return {
    readMarketSession: (request) =>
      scopedSlow(deps, request.signal, async (scope) => {
        const region = resolveRegion(deps, request.region)
        const text = await deps.services.marketSession({
          region,
          locale: request.locale,
          signal: scope.signal,
        })

        return { region, text: text.split(LINE_BREAK) }
      }),
  }
}

/** The whole-market reads: each may refresh a cold market first, so each gets the slow ceiling. */
function boardMethods(
  deps: TradingHostDeps
): Omit<
  MarketMethods,
  | keyof PriceMethods
  | keyof SeriesMethods
  | keyof ListingMethods
  | keyof IndexMethods
  | keyof SessionMethods
> {
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
  return {
    ...seriesMethods(deps),
    ...priceMethods(deps),
    ...listingMethods(deps),
    ...indexMethods(deps),
    ...sessionMethods(deps),
    ...boardMethods(deps),
  }
}
