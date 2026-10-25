import type { Logger } from '@/core/logging/logger'
import type { MarketDataRunDeps } from '@/trading/features/market-data/market-data-run'
import type { EnsureMarketData } from '@/trading/features/market-data/ops/refresh'
import type {
  ExclusionReader,
  MarketDataMarketRequest,
  MarketDataScreenRequest,
  MarketDataService,
  ScreenView,
} from '@/trading/features/market-data/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type {
  InstrumentKind,
  InstrumentRef,
  MarketRef,
  ScreenableKinds,
  TradingDay,
} from '@/trading/kernel/instrument'
import type {
  ScreenCandidate,
  ScreenResult,
  SectorStrengthResult,
} from '@/trading/kernel/market/market-capability'
import type { Quote } from '@/trading/kernel/market/market-data'
import type { MarketDay } from '@/trading/markets/calendar'
import type {
  Market,
  MarketRegistry,
  SourceRegistry,
  TradingCalendar,
} from '@/trading/markets/types'
import type { QuoteConvention } from '@/trading/render/money'
import { isAbortError } from '@/core/errors'
import { mapWithConcurrency } from '@/core/utils/concurrency'
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
import { describeMarket } from '@/trading/features/market-data/reads/describe'
import { freshnessOf, settledEvidenceCaveats } from '@/trading/features/market-data/reads/freshness'
import { runOverviews } from '@/trading/features/market-data/reads/overview'
import { buildQuoteBoard } from '@/trading/features/market-data/reads/quote-board'
import {
  runAccounts,
  runBars,
  runEvents,
  runFunding,
  runQuote,
  runQuoteConvention,
  runRecommendations,
} from '@/trading/features/market-data/reads/quotes'
import { runSentiment } from '@/trading/features/market-data/reads/sentiment'
import { resolveDay, searchInstruments } from '@/trading/features/market-data/resolve'
import { pricedCandidate } from '@/trading/features/market-data/screen-caution'
import { unsupportedScreen, unsupportedSectors } from '@/trading/features/market-data/unsupported'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { ECONOMY_FEED_SCOPE } from '@/trading/kernel/source/source-result'
import { resolveMarketDay } from '@/trading/markets/calendar'
import { convictionDriftCaveats } from '@/trading/markets/conviction-calibration'
import { countByGate } from '@/trading/markets/screen-partition'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const SCREEN_QUOTE_CONCURRENCY = 4
/** Enough to carry every name a crypto screen examines, so its board is always fully explained.
 *  A VN screen gates its whole universe and truncates; the counts still cover all of it. */
const SCREEN_LOG_REJECTIONS = 40

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
  const run = {
    logger: deps.logger,
    markets: deps.markets,
    config: deps.config,
    ensure: deps.ensure,
  }

  return {
    listSources: () => deps.sources.list(),
    regions: () => deps.markets.regions(),
    markets: () => deps.markets.list().map((market) => market.manifest.id),
    quoteConvention: (market) => quoteConventionOf(deps.markets, market),
    describeMarkets: () => deps.markets.list().map(describeMarket),
    marketDay: (market, now) => marketDayOf(deps.markets, market, now),
    instrumentQuoteConvention: (options) => runQuoteConvention(run, options),
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

  // Before the refresh, not after: a kind this market does not hold asks for a board that cannot
  // exist, and answering it with an empty one is indistinguishable from every name being rejected.
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

  const ensured = await deps.ensure(buildEnsureOptions(options.market, options))
  const result = await market.capabilities.screen?.run({
    market: options.market,
    limit: options.limit,
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
      ...convictionDriftCaveats(result.bandCounts),
      ...marked.caveats,
    ]),
  }
}

/** Which names cleared the gates and which gate stopped each of the rest. Two runs minutes apart
 *  can return different boards, and without the per-name verdict there is no telling a market that
 *  moved from a screen that changed. */
function logScreen(logger: Logger, options: MarketDataScreenRequest, result: ScreenResult): void {
  const omitted = result.rejections.length - SCREEN_LOG_REJECTIONS

  logger.debug('trading.screen_completed', {
    market: options.market,
    // The board is truncated to this before anyone sees it, so a shorter board than the survivor
    // count explains itself only when the cap that cut it is on the same line.
    limit: options.limit,
    asOf: result.asOf,
    universeSize: result.universeSize,
    ...(result.bandCounts === undefined ? {} : { bandCounts: result.bandCounts }),
    candidates: result.candidates.map((candidate) => candidate.instrument.ticker),
    rejectedByGate: countByGate(result.rejections),
    rejected: result.rejections
      .slice(0, SCREEN_LOG_REJECTIONS)
      .map((rejection) => `${rejection.instrument.ticker}:${rejection.code}`),
    ...(omitted > 0 ? { rejectedOmitted: omitted } : {}),
  })
}

/** The board's rank is settled by design, and the price says what the name costs now. A market
 *  still trading answers with a live quote; one that has closed answers with the close the rank
 *  was built on, labelled as such — dropping it there left a board with no price for every hour
 *  outside the session, which for a VN board is most of the day. Best-effort per name: a name
 *  whose quote fails keeps its rank-only row, and so carries no caution either. A market that swept
 *  the universe already answered; where it did not, the per-name fetch is bounded by the board a
 *  surface can show, past which the request is a bulk score read rather than a board. */
async function withPrices(
  market: Market,
  candidates: readonly ScreenCandidate[],
  options: MarketDataScreenRequest
): Promise<readonly ScreenCandidate[]> {
  if (candidates.length === 0) {
    return candidates
  }

  const calendar = market.manifest.calendar
  const scope: QuoteScope = {
    quote: market.capabilities.quote,
    calendar,
    timezone: calendar.timezone,
    asOf: resolveDay(market, options.now),
    now: options.now,
    signal: options.signal,
  }
  const fetchMissing = candidates.length <= SURFACE_LIMITS.maximumScreenCandidates

  return mapWithConcurrency(candidates, SCREEN_QUOTE_CONCURRENCY, async (candidate) => {
    const quote =
      candidate.liveQuote ??
      (fetchMissing ? await quotedValue(scope, candidate.instrument) : undefined)

    if (quote === undefined) {
      return candidate
    }

    return pricedCandidate(candidate, quote, freshnessOf(scope, quote.observedAt, options.now))
  })
}

interface QuoteScope {
  readonly quote: Market['capabilities']['quote']
  readonly calendar: TradingCalendar
  readonly timezone: string
  readonly asOf: TradingDay
  readonly now: number
  readonly signal: AbortSignal
}

/** Decorative: a market that cannot answer, or throws answering, leaves the ranked board standing
 *  with the settled close it was built on. */
async function quotedValue(
  scope: QuoteScope,
  instrument: InstrumentRef
): Promise<Quote | undefined> {
  if (scope.quote === undefined) {
    return undefined
  }

  try {
    const result = await scope.quote.run({
      instrument,
      asOf: scope.asOf,
      now: scope.now,
      signal: scope.signal,
    })

    return result.kind === 'available' ? result.value : undefined
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    // The overlay must not take the board down with it. A cancel still unwinds: swallowing one
    // would fan through every remaining candidate and hand back a board nobody asked for.
    return undefined
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
