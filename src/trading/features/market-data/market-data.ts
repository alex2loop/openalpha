import type { Logger } from '@/core/logging/logger'
import type { MarketDataRunDeps } from '@/trading/features/market-data/market-data-run'
import type { EnsureMarketData } from '@/trading/features/market-data/ops/ensure'
import type {
  ExclusionReader,
  MarketDataMarketRequest,
  MarketDataScreenRequest,
  MarketDataService,
  ScreenView,
} from '@/trading/features/market-data/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingConfig } from '@/trading/kernel/config'
import type {
  InstrumentKind,
  MarketRef,
  ScreenableKinds,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { ScreenResult, SectorStrengthResult } from '@/trading/kernel/market/market-capability'
import type { MarketDay } from '@/trading/markets/calendar'
import type { Market, MarketRegistry, SourceRegistry } from '@/trading/markets/types'
import type { QuoteConvention } from '@/trading/render/money'
import {
  runBasis,
  runCuratedNews,
  runFlows,
  runMacroRisk,
  runNews,
  runNewsPerMarket,
  runTapeNews,
} from '@/trading/features/market-data/context'
import { buildEnsureOptions, requireMarket } from '@/trading/features/market-data/market-data-run'
import { markExcluded } from '@/trading/features/market-data/ops/exclusions'
import { markMarginIneligible } from '@/trading/features/market-data/ops/margin'
import { logScreen } from '@/trading/features/market-data/ops/screen-log'
import { isBoardForm, withPrices } from '@/trading/features/market-data/ops/screen-prices'
import { describeMarket } from '@/trading/features/market-data/reads/describe'
import { settledEvidenceCaveats } from '@/trading/features/market-data/reads/freshness'
import { indexReads } from '@/trading/features/market-data/reads/index-reading'
import { runOverviews } from '@/trading/features/market-data/reads/overview'
import { buildQuoteBoard } from '@/trading/features/market-data/reads/quote-board'
import {
  instrumentReads,
  runAccounts,
  runBars,
  runEvents,
  runFunding,
  runQuote,
  runRecommendations,
} from '@/trading/features/market-data/reads/quotes'
import { runSentiment } from '@/trading/features/market-data/reads/sentiment'
import { resolveDay, searchInstruments } from '@/trading/features/market-data/resolve'
import { toBoardView } from '@/trading/features/market-data/screen-board'
import { unsupportedScreen, unsupportedSectors } from '@/trading/features/market-data/unsupported'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { ECONOMY_FEED_SCOPE } from '@/trading/kernel/source/source-result'
import { resolveMarketDay } from '@/trading/markets/calendar'
import { convictionDriftCaveats } from '@/trading/markets/conviction-calibration'

/** A limit no board reaches: the market cuts to it after ranking, so it cuts nothing. */
const WHOLE_BOARD = Number.POSITIVE_INFINITY

interface MarketDataServiceDeps {
  readonly logger: Logger
  readonly markets: MarketRegistry
  readonly sources: SourceRegistry
  readonly config: TradingConfig
  readonly ensure: EnsureMarketData
  readonly exclusions: ExclusionReader
}

/** The one holder of the market and source registries. Every surface above it hands over
 *  unresolved input — a bare ticker, an instant, a day range — and receives a typed result whose
 *  unavailable arm names why. Nothing above this layer sees a registry. */
export function createMarketDataService(deps: MarketDataServiceDeps): MarketDataService {
  const { logger, markets, config, ensure } = deps
  const run = { logger, markets, config, ensure }

  return {
    listSources: () => deps.sources.list(),
    regions: () => deps.markets.regions(),
    markets: () => deps.markets.list().map((market) => market.manifest.id),
    quoteConvention: (market) => quoteConventionOf(deps.markets, market),
    describeMarkets: () => deps.markets.list().map(describeMarket),
    marketDay: (market, now) => marketDayOf(deps.markets, market, now),
    ...instrumentReads(run),
    minimumRiskReward: (market) => deps.markets.find(market)?.manifest.minimumRiskReward,
    boardLot: (market) => deps.markets.find(market)?.manifest.boardLot,
    trailsStop: (market) => deps.markets.find(market)?.trail !== undefined,
    screenableKinds: () => screenableKinds(deps.markets),
    quoteBoard: (options) =>
      buildQuoteBoard({ markets: deps.markets, timezone: deps.config.displayTimezone }, options),
    quote: (options) => runQuote(run, options),
    bars: (options) => runBars(run, options),
    events: (options) => runEvents(run, options),
    funding: (options) => runFunding(run, options),
    recommendations: (options) => runRecommendations(run, options),
    accounts: (options) => runAccounts(run, options),
    flows: (options) => runFlows(run, options),
    news: (options) => runNews(run, options),
    newsPerMarket: (options) => runNewsPerMarket(run, options),
    macroNews: (options) => runTapeNews(deps.sources, options),
    economyNews: (options) => runTapeNews(deps.sources, options, ECONOMY_FEED_SCOPE),
    curatedNews: (options) => runCuratedNews(run, options),
    macroRisk: (options) => runMacroRisk(run, options),
    basis: (options) => runBasis(run, options),

    overview: (options) => runOverviews(run, options),
    screen: (options) => runScreen(run, options, deps.exclusions),
    searchInstruments: (options) => searchInstruments(deps.markets, options),
    sectors: (options) => runSectors(run, options),
    ...indexReads(run),

    sentiment: (options) => runSentiment(run, options),
  }
}

function screenableKinds(markets: MarketRegistry): ScreenableKinds {
  return new Map(
    markets
      .list()
      .flatMap((market) =>
        market.manifest.screenableKinds === undefined
          ? []
          : [[market.manifest.id, market.manifest.screenableKinds] as const]
      )
  )
}

// Answered before the refresh: a board this market cannot build must not read as every name
// being rejected.
function screenRefusal(
  market: ReturnType<typeof requireMarket>,
  options: MarketDataScreenRequest,
  asOf: TradingDay
): ScreenView | undefined {
  const kinds = market.manifest.screenableKinds ?? []

  if (options.instrumentKind !== undefined && !kinds.includes(options.instrumentKind)) {
    return unscreenableKind({
      asOf,
      market: options.market,
      instrumentKind: options.instrumentKind,
    })
  }

  // A sector filter on a market with no sector data can only empty the board, and an empty board
  // reads as every name being rejected.
  if (options.sectors !== undefined && market.capabilities.sectors === undefined) {
    return {
      ...unsupportedScreen(asOf),
      caveats: [{ code: 'market-data.sectors-unsupported' }],
    }
  }

  return undefined
}

async function runScreen(
  deps: MarketDataRunDeps,
  options: MarketDataScreenRequest,
  reader: ExclusionReader
): Promise<ScreenView> {
  const market = requireMarket(deps, options.market)
  const asOf = resolveDay(market, options.now)
  const refused = screenRefusal(market, options, asOf)

  if (refused !== undefined) {
    return refused
  }

  // A board is a browse the visitor repeats: a market on its first load answers from what is stored.
  const answer = isBoardForm(options) ? { partialAnswer: true as const } : undefined
  const ensured = await deps.ensure(buildEnsureOptions(options.market, options, answer))
  const result = await market.capabilities.screen?.run({
    market: options.market,
    // A board is every name the gates cleared, so nothing is cut before its prices are read.
    limit: isBoardForm(options) ? WHOLE_BOARD : options.limit,
    asOf,
    now: options.now,
    signal: options.signal,
    ...(options.instrumentKind === undefined ? {} : { instrumentKind: options.instrumentKind }),
    ...(options.sectors === undefined ? {} : { sectors: options.sectors }),
  })

  if (result === undefined) {
    return unsupportedScreen(asOf)
  }

  logScreen(deps.logger, options, result)

  const view = await decorateScreen(deps, { market, options, result, ensured, asOf }, reader)

  return isBoardForm(options) ? toBoardView(view) : view
}

interface ScreenRead {
  readonly market: Market
  readonly options: MarketDataScreenRequest
  readonly result: ScreenResult
  readonly ensured: readonly Caveat[]
  readonly asOf: TradingDay
}

/** What the operator's own state adds to the market's answer: live prices, the names they excluded,
 *  the margin list, and the caveats those reads raise. */
async function decorateScreen(
  deps: MarketDataRunDeps,
  read: ScreenRead,
  reader: ExclusionReader
): Promise<ScreenView> {
  const { market, options, result, ensured, asOf } = read
  const marked = await markExcluded({
    candidates: await withPrices(market, result.candidates, options),
    reader,
    logger: deps.logger,
    signal: options.signal,
  })

  return {
    ...result,
    currency: market.manifest.currency,
    timezone: market.manifest.calendar.timezone,
    candidates: await markMarginIneligible({
      market,
      candidates: marked.candidates,
      asOf,
      now: options.now,
      signal: options.signal,
      logger: deps.logger,
    }),
    caveats: dedupeCaveats([
      ...result.caveats,
      ...ensured,
      ...settledEvidenceCaveats(market, options.now),
      // How wide the top band runs is a claim about the ranking, which a board does not print.
      ...(isBoardForm(options) ? [] : convictionDriftCaveats(result.bandCounts)),
      ...marked.caveats,
    ]),
  }
}

interface UnscreenableKind {
  readonly asOf: TradingDay
  readonly market: MarketRef
  readonly instrumentKind: InstrumentKind
}

/** An empty board whose caveat names the kind that emptied it, so a caller that guessed the
 *  argument can drop it and ask again instead of reading the market as having nothing to offer. */
function unscreenableKind(input: UnscreenableKind): ScreenResult {
  return {
    asOf: input.asOf,
    candidates: [],
    rejections: [],
    universeSize: 0,
    provenance: [],
    caveats: [
      {
        code: 'market-data.kind-unsupported',
        detail: { market: input.market, instrumentKind: input.instrumentKind },
      },
    ],
  }
}

async function runSectors(
  deps: MarketDataRunDeps,
  options: MarketDataMarketRequest
): Promise<SectorStrengthResult> {
  const market = requireMarket(deps, options.market)
  const asOf = resolveDay(market, options.now)
  const ensured = await deps.ensure(buildEnsureOptions(options.market, options))
  const result = await market.capabilities.sectors?.run({
    asOf,
    now: options.now,
    signal: options.signal,
  })

  if (result === undefined) {
    return unsupportedSectors(asOf)
  }

  return { ...result, caveats: dedupeCaveats([...result.caveats, ...ensured]) }
}

/** Absent rather than a fabricated convention: a market the registry does not list has no rule for
 *  printing its prices, and inventing one would label a number in a unit nobody declared. */
function quoteConventionOf(
  markets: MarketRegistry,
  market: MarketRef
): QuoteConvention | undefined {
  const manifest = markets.list().find((entry) => entry.manifest.id === market)?.manifest

  if (manifest === undefined) {
    return undefined
  }

  return {
    currency: manifest.currency,
    unit: manifest.quoteUnit,
    ...(manifest.priceDisplay === undefined ? {} : { display: manifest.priceDisplay }),
  }
}

/** Absent for a market the registry does not list or one that never closes, as its hours are. */
function marketDayOf(
  markets: MarketRegistry,
  market: MarketRef,
  now: number
): MarketDay | undefined {
  const calendar = markets.find(market)?.manifest.calendar

  return calendar === undefined || calendar.continuous ? undefined : resolveMarketDay(calendar, now)
}
