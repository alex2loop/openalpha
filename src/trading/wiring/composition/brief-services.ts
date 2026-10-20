import type { App } from '@/core/container'
import type { BookSummary, BriefAlertRow, BriefServices } from '@/trading/features/brief/types'
import type { SizedValuedBook } from '@/trading/features/portfolio/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type { CurrencyCode, InstrumentRef, MarketRef } from '@/trading/kernel/instrument'
import type { AlertCondition } from '@/trading/kernel/operator/alert'
import type { VenueRegistry } from '@/trading/venues/types'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import { withoutResidue } from '@/trading/features/portfolio/folds/holdings'
import { marksByInstrument } from '@/trading/features/portfolio/view'
import { DEFAULT_FOCUS_KEY, DEFAULT_RUN_FOCUS } from '@/trading/kernel/operator/focus'
import { createTradeableBook } from '@/trading/wiring/composition/delivery-reads'

/** The brief's sweep is the operator's own: its calls drive the book. */
async function runOperatorBatch(
  services: TradingServices,
  o: Parameters<BriefServices['runSuggestions']>[0]
): ReturnType<BriefServices['runSuggestions']> {
  const batch = await services.suggestions.runBatch({
    ...o,
    scope: { kind: 'items', items: o.items },
    focus: DEFAULT_RUN_FOCUS,
  })

  return batch.results
}

/** Each method resolves the owning service at call time, so a market can be built before the
 *  services that depend on the market registry exist. A market never holds a service reference. */
export function lazyBriefServices(
  app: App,
  config: TradingConfig,
  venues: VenueRegistry
): BriefServices {
  const services = (): TradingServices => app.resolve('tradingServices')

  return {
    listResolvedSuggestions: (o) =>
      services().suggestions.listResolved({
        resolvedAfter: o.since,
        focusKeys: [DEFAULT_FOCUS_KEY],
        limit: o.limit,
        signal: o.signal,
      }),
    listFiredAlerts: async (o) =>
      toAlertRows(
        services(),
        await services().alerts.listFired({ firedAfter: o.since, limit: o.limit, signal: o.signal })
      ),
    rebalance: (o) => services().portfolio.rebalance({ now: o.now, signal: o.signal }),
    ...lazyBookReads(services, config, venues),
    profile: (o) =>
      services().profiles.get({ defaultLocale: app.config.locale.language, signal: o.signal }),
    summarize: (o) => services().suggestions.summarize(o),
    ...lazyMarketDataReads(services),
    runSuggestions: (o) => runOperatorBatch(services(), o),
    positionExits: async (o) => toAlertRows(services(), await services().alerts.positionExits(o)),
    unwatchedPositions: (o) => services().alerts.unwatchedPositions(o),
    stalePositions: async (o) =>
      services().alerts.stalePositions({
        ...o,
        profile: await services().profiles.get({
          defaultLocale: app.config.locale.language,
          signal: o.signal,
        }),
      }),
    stopDistances: (o) => services().alerts.stopDistances(o),
    previousSections: async (o) => {
      const previous = await app
        .resolve('tradingStores')
        .brief.findPrevious({ before: o.before, authoredLocale: o.locale, signal: o.signal })

      return previous?.sections ?? null
    },
  }
}

/** The brief describes only markets the operator still reads: a switched-off segment would otherwise
 *  be warmed on the brief's first morning and then reported stale every morning after. */
async function marketsInUse(services: TradingServices, signal: AbortSignal): Promise<MarketRef[]> {
  return [...(await services.marketsInUse(signal))]
}

/** The book as the brief reads it: valued for the headline, and only what can still be traded where
 *  a section names holdings. */
function lazyBookReads(
  services: () => TradingServices,
  config: TradingConfig,
  venues: VenueRegistry
): Pick<BriefServices, 'bookSummary' | 'holdings'> {
  return {
    bookSummary: async (o) => {
      const sized = await services().portfolio.viewAbsoluteSized({ now: o.now, signal: o.signal })

      // Zero is not a value to report: a book with nothing recorded has nothing to say, and a
      // headline reading 0 reads as a loss. An unknown total is still a book.
      return sized.valued.navBase !== undefined && sized.valued.navBase <= 0
        ? null
        : toBookSummary(sized, config.baseCurrency)
    },
    holdings: async (o) => {
      const book = createTradeableBook({ portfolio: services().portfolio, venues })
      const holdings = await book.tradeableHoldingsAt({ now: o.now, signal: o.signal })

      return holdings.map((holding) => holding.instrument)
    },
  }
}

/** The reads that pass straight through to market data, resolved the same lazy way. */
function lazyMarketDataReads(
  services: () => TradingServices
): Pick<
  BriefServices,
  'quoteBoard' | 'overview' | 'basis' | 'marketNews' | 'macroNews' | 'economyNews'
> {
  return {
    quoteBoard: (o) => services().marketData.quoteBoard(o),
    overview: async (o) =>
      services().marketData.overview({ ...o, markets: await marketsInUse(services(), o.signal) }),
    basis: (o) => services().marketData.basis(o),
    marketNews: async (o) =>
      services().marketData.newsPerMarket({
        ...o,
        markets: await marketsInUse(services(), o.signal),
      }),
    macroNews: (o) => services().marketData.macroNews(o),
    economyNews: (o) => services().marketData.economyNews(o),
  }
}

/** One mapper for both level sections: a fired alert and a crossed plan level are the same row to
 *  a reader, and only the market knows what currency its prices are in. */
function toAlertRows(
  services: TradingServices,
  rows: readonly {
    readonly instrument: InstrumentRef
    readonly condition: AlertCondition
    readonly threshold: number
    readonly observedPrice: number
  }[]
): readonly BriefAlertRow[] {
  return rows.map((row) => {
    const currency = services.marketData.quoteConvention(row.instrument.market)?.currency

    return {
      instrument: row.instrument,
      condition: row.condition,
      threshold: row.threshold,
      observedPrice: row.observedPrice,
      ...(currency === undefined ? {} : { currency }),
    }
  })
}

/** The headline plus what it is made of: the loss section counts the under-water leg from the
 *  same valuation the headline reads. A sliver the venue will not trade stays in the headline but
 *  is no holding: it has no plan, and counting it reported dust as positions without a stop. */
function toBookSummary(
  { valued, minimumSizes }: SizedValuedBook,
  currency: CurrencyCode
): BookSummary {
  return {
    ...(valued.navBase === undefined ? {} : { nav: valued.navBase }),
    currency,
    positions: withoutResidue(valued, minimumSizes).positions.flatMap((entry) =>
      entry.kind === 'priced'
        ? [
            {
              instrument: entry.position.instrument,
              costBase: entry.position.costBasisBase,
              valueBase: entry.valueBase,
            },
          ]
        : []
    ),
    marks: marksByInstrument(valued),
  }
}
