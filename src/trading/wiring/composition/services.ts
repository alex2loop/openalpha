import type { Logger } from '@/core/logging/logger'
import type { Budget } from '@/core/types/budget'
import type { Locale } from '@/core/types/locale'
import type { AlertService } from '@/trading/features/alerts/types'
import type { BriefService } from '@/trading/features/brief/types'
import type {
  EnsureMarketData,
  RefreshMarketData,
} from '@/trading/features/market-data/ops/refresh'
import type { ExclusionReader, MarketDataService } from '@/trading/features/market-data/types'
import type { OrderService } from '@/trading/features/order/types'
import type { NavService } from '@/trading/features/portfolio/nav/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { ProfileService } from '@/trading/features/profile/types'
import type { ExitPlanner } from '@/trading/features/suggestion/exit-plan/types'
import type { RunDebate } from '@/trading/features/suggestion/pipeline/types'
import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import type { FactorLogService } from '@/trading/features/suggestion/track-record/factor-log-types'
import type { TradingConfig } from '@/trading/kernel/config'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { FxRates } from '@/trading/kernel/market/fx-rates'
import type { TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { StageRegistry } from '@/trading/markets/stage'
import type { MarketRegistry, SourceRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import type { TradingStores } from '@/trading/wiring/composition/stores'
import { createAlertService } from '@/trading/features/alerts/alerts'
import { createBriefService } from '@/trading/features/brief/brief'
import { buildVenueFillKey } from '@/trading/features/ledger/sync'
import { createMarketDataService } from '@/trading/features/market-data/market-data'
import { createEnsureMarketData } from '@/trading/features/market-data/ops/refresh'
import { createOrderService } from '@/trading/features/order/execute'
import { OrderError } from '@/trading/features/order/types'
import { createNavService } from '@/trading/features/portfolio/nav/history'
import { createPortfolioService } from '@/trading/features/portfolio/portfolio'
import { createProfileService } from '@/trading/features/profile/profile'
import { createExitPlanner } from '@/trading/features/suggestion/exit-plan/recorded'
import { createReduceVerdicts } from '@/trading/features/suggestion/reduce-verdicts'
import { createSuggestionService } from '@/trading/features/suggestion/suggestion'
import { createFactorLogService } from '@/trading/features/suggestion/track-record/factor-log-service'
import { createTradeableBook } from '@/trading/wiring/composition/delivery-reads'
import {
  createPortfolioReader,
  listFillsSince,
} from '@/trading/wiring/composition/portfolio-reader'

interface DomainServices {
  readonly marketData: MarketDataService
  readonly portfolio: PortfolioService
  readonly profiles: ProfileService
  readonly exitPlans: ExitPlanner
  readonly suggestions: SuggestionService
  readonly factorLog: FactorLogService
  readonly nav: NavService
  readonly alerts: AlertService
  readonly briefs: BriefService
  readonly order?: OrderService
}

interface DomainServiceDeps {
  readonly stores: TradingStores
  readonly markets: MarketRegistry
  readonly sources: SourceRegistry
  readonly stages: StageRegistry
  readonly refresh: RefreshMarketData
  readonly sender: TradingNoticeSender
  readonly config: TradingConfig
  readonly logger: Logger
  readonly runDebate: RunDebate
  createSuggestionBudget(): Budget
  readonly defaultLocale: Locale
  readonly skillVersions: readonly string[]
  readonly personaVersions: readonly string[]
  readonly venues: VenueRegistry
  /** Built beside the market registry so the markets and the money read one conversion path. */
  readonly fx: FxRates
}

function buildProfiles(deps: DomainServiceDeps): ProfileService {
  return createProfileService({
    profiles: deps.stores.profile,
    markets: deps.markets,
    baseCurrency: deps.config.baseCurrency,
    homeRegion: deps.config.defaultRegion,
    heldMarkets: deps.venues.heldMarkets(),
  })
}

interface BookParts {
  readonly deps: DomainServiceDeps
  readonly marketData: MarketDataService
  readonly fx: FxRates
  readonly profile: ProfileService
  readonly exitPlans: ExitPlanner
}

function buildPortfolio(parts: BookParts): PortfolioService {
  const { deps, marketData, fx, profile, exitPlans } = parts

  return createPortfolioService({
    ledger: deps.stores.ledger,
    profile,
    exitPlans,
    reduceVerdicts: createReduceVerdicts(deps.stores.suggestion),
    markets: deps.markets,
    venues: deps.venues,
    logger: deps.logger,
    marketDataStore: deps.stores.marketData,
    marketData,
    fx,
    config: deps.config,
    baseCurrency: deps.config.baseCurrency,
    defaultRegion: deps.config.defaultRegion,
    costs: deps.config.costs,
    defaultLocale: deps.defaultLocale,
  })
}

function buildNav(deps: DomainServiceDeps, profiles: ProfileService): NavService {
  return createNavService({
    store: deps.stores.navSnapshot,
    profiles,
    markets: deps.markets,
    marketDataStore: deps.stores.marketData,
    config: deps.config,
    timezone: deps.config.displayTimezone,
    defaultLocale: deps.defaultLocale,
  })
}

/** The one assembly point. Market data is built first because three of the other four read prices
 *  through it, and the portfolio seam the suggestion pipeline needs is the portfolio service's own
 *  read path rather than a second one that could value a book differently. */
export function createDomainServices(deps: DomainServiceDeps): DomainServices {
  const { fx } = deps
  const ensure = createEnsureMarketData({
    markets: deps.markets,
    marketDataStore: deps.stores.marketData,
    refresh: deps.refresh,
  })
  // The store's own read, not the service's: `find` never seeds, and a screen must not be what
  // creates a profile row for an operator who has never set one.
  const exclusions: ExclusionReader = {
    exclusions: async (signal) => (await deps.stores.profile.find(signal))?.exclusions ?? [],
  }
  const marketData = createMarketDataService({
    logger: deps.logger,
    markets: deps.markets,
    sources: deps.sources,
    config: deps.config,
    ensure,
    exclusions,
  })
  const profiles = buildProfiles(deps)
  const { portfolio, exitPlans } = buildBookWithPlans({
    deps,
    marketData,
    fx,
    profile: profiles,
  })
  const order = buildOrder({ deps, marketData, fx, portfolio })
  const delivery = createDeliveryServices({
    deps,
    marketData,
    ensure,
    portfolio,
    profiles,
    exitPlans,
    ...(order === undefined ? {} : { order }),
  })
  const suggestions = buildSuggestions({ deps, fx, portfolio, profiles, ensure })
  const factorLog = createFactorLogService({
    markets: deps.markets,
    store: deps.stores.factorLog,
    listingStatus: async (instrument, signal) =>
      (await deps.stores.marketData.findInstrument({ instrument, signal }))?.status,
  })

  return {
    marketData,
    portfolio,
    profiles,
    exitPlans,
    ...(order === undefined ? {} : { order }),
    suggestions,
    factorLog,
    nav: buildNav(deps, profiles),
    ...delivery,
  }
}

interface SuggestionParts {
  readonly deps: DomainServiceDeps
  readonly fx: FxRates
  readonly portfolio: PortfolioService
  readonly profiles: ProfileService
  readonly ensure: EnsureMarketData
}

function buildSuggestions(parts: SuggestionParts): SuggestionService {
  const { deps, fx, portfolio, profiles, ensure } = parts

  return createSuggestionService({
    markets: deps.markets,
    stages: deps.stages,
    store: deps.stores.suggestion,
    agentFocuses: deps.stores.agentFocuses,
    profiles: deps.stores.profile,
    portfolio: createPortfolioReader({ portfolio, profile: profiles, deps, fx }),
    fills: (options) => listFillsSince(portfolio, options),
    config: deps.config,
    logger: deps.logger,
    runDebate: deps.runDebate,
    ensure,
    createSuggestionBudget: () => deps.createSuggestionBudget(),
    skillVersions: deps.skillVersions,
    personaVersions: deps.personaVersions,
  })
}

interface ExitPlannerServices {
  readonly portfolio: PortfolioService
  readonly profiles: ProfileService
}

/** The planner reads the book and the book writes plans through it. One forwarding object breaks
 *  the construction order; neither is reachable before this function returns. */
function buildBookWithPlans(parts: Omit<BookParts, 'exitPlans'>): {
  readonly portfolio: PortfolioService
  readonly exitPlans: ExitPlanner
} {
  const lazyExitPlans: ExitPlanner = { plan: (options) => exitPlans.plan(options) }
  const portfolio = buildPortfolio({ ...parts, exitPlans: lazyExitPlans })
  const exitPlans = buildExitPlanner(parts.deps, { portfolio, profiles: parts.profile })

  return { portfolio, exitPlans }
}

function buildExitPlanner(deps: DomainServiceDeps, services: ExitPlannerServices): ExitPlanner {
  return createExitPlanner({
    markets: deps.markets,
    store: deps.stores.suggestion,
    holdingsAt: createTradeableBook({ portfolio: services.portfolio, venues: deps.venues })
      .tradeableHoldingsAt,
    profile: services.profiles,
    defaultLocale: deps.defaultLocale,
  })
}

interface OrderParts {
  readonly deps: DomainServiceDeps
  readonly marketData: MarketDataService
  readonly fx: FxRates
  readonly portfolio: PortfolioService
}

/** The write path gets one number from market data and one from FX, never either service: binding
 *  them would hand it reads it has no business making. */
function buildOrder(parts: OrderParts): OrderService | undefined {
  const { deps, fx, marketData, portfolio } = parts
  // No venue that accepts orders means no exchange this tree can place on, so `/trade` is never
  // registered rather than offered and failing at the moment the operator uses it.
  if (!deps.venues.list().some((venue) => venue.adapter !== undefined)) {
    return undefined
  }

  return createOrderService({
    venues: deps.venues,
    intents: deps.stores.orderIntent,
    resting: deps.stores.restingExit,
    settings: deps.stores.orderSettings,
    portfolio,
    markets: deps.markets,
    policy: deps.config.orders,
    costs: deps.config.costs,
    logger: deps.logger,
    findProfile: (signal) => deps.stores.profile.find(signal),
    quoteOf: (instrument, now, signal) => quoteOf(marketData, instrument, { now, signal }),
    findRecordedFill: async (venue, orderId, signal) =>
      (
        await deps.stores.ledger.findByIdempotency({
          idempotencyKey: buildVenueFillKey(venue, orderId),
          signal,
        })
      )?.entry,
    toBaseCurrency: async (input) => {
      const quote = await fx.convert({
        fromCurrency: input.currency,
        toCurrency: deps.config.baseCurrency,
        asOf: input.asOf,
        signal: input.signal,
      })

      if (quote.kind !== 'available') {
        throw new OrderError('order.rejected', `no rate from ${input.currency} to the book`)
      }

      return input.amount * quote.value.rate
    },
  })
}

/** The live price the caps, the drift check and the prompt all read. An unpriced instrument is a
 *  refusal, not a zero: every cap downstream would pass against one. */
async function quoteOf(
  marketData: MarketDataService,
  instrument: InstrumentRef,
  at: { readonly now: number; readonly signal: AbortSignal }
): Promise<number> {
  const result = await marketData.quote({
    ticker: instrument.ticker,
    market: instrument.market,
    now: at.now,
    signal: at.signal,
  })

  // A close or a stale print also reads as available; sizing and drift run on the live tape only.
  if (result.kind !== 'available' || result.value.observed.kind !== 'live') {
    throw new OrderError('order.quote_not_live', `no live price for ${instrument.ticker}`)
  }

  return result.value.quote.price
}

/** The two unattended senders, split out only to keep the assembly point readable. Both render in
 *  `[locale] language`: neither has a chat turn to read a locale from. */
interface DeliveryDeps {
  readonly deps: DomainServiceDeps
  readonly marketData: MarketDataService
  readonly ensure: EnsureMarketData
  readonly portfolio: PortfolioService
  readonly profiles: ProfileService
  readonly exitPlans: ExitPlanner
  /** Absent on an install with no exchange. */
  readonly order?: Pick<OrderService, 'restingStops'>
}

function createDeliveryServices(delivery: DeliveryDeps): Pick<DomainServices, 'alerts' | 'briefs'> {
  const { deps, marketData, ensure, profiles, order } = delivery
  const briefs = createBriefService({
    store: deps.stores.brief,
    deliveries: deps.stores.briefDelivery,
    defaultLocale: deps.defaultLocale,
    profiles: deps.stores.profile,
    markets: deps.markets,
    ensure,
    sender: deps.sender,
    config: deps.config,
    logger: deps.logger,
    createSuggestionBudget: () => deps.createSuggestionBudget(),
  })

  return {
    briefs,
    alerts: createAlertService({
      defaultLocale: deps.defaultLocale,
      store: deps.stores.alert,
      markets: deps.markets,
      marketData,
      sender: deps.sender,
      config: deps.config,
      logger: deps.logger,
      suggestions: deps.stores.suggestion,
      briefs,
      marketDataStore: deps.stores.marketData,
      tradeableHoldingsAt: createTradeableBook({
        portfolio: delivery.portfolio,
        venues: delivery.deps.venues,
      }).tradeableHoldingsAt,
      instrumentKinds: async (options) =>
        (await delivery.portfolio.viewAbsoluteWithKinds(options)).instrumentKinds,
      getProfile: (options) => profiles.get(options),
      exitPlans: delivery.exitPlans,
      ...(order === undefined ? {} : { restingStops: (options) => order.restingStops(options) }),
    }),
  }
}
