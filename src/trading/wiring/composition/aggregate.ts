import type { TaskPassListener } from '@/core/container'
import type { ReachabilityProbe } from '@/core/limits'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { createConfiguredRunBudget } from '@/engine/api'
import type { PublicBriefPublisher } from '@/trading/features/brief/public/types'
import type { IntradayReportDeps } from '@/trading/features/market-data/intraday/report'
import type { HeldWatch } from '@/trading/features/market-data/ops/held-watch'
import type { RefreshMarketData } from '@/trading/features/market-data/ops/refresh'
import type { OperationPolicy, TradingConfig } from '@/trading/kernel/config'
import type { MarketRef } from '@/trading/kernel/instrument'
import type {
  RefreshAllMarketDataOptions,
  RefreshMarketDataResult,
} from '@/trading/kernel/market/refresh'
import type { DeliveryAddress } from '@/trading/kernel/operator/delivery'
import type { OrderFilledListener, TradingNoticeSender } from '@/trading/kernel/operator/notice'
import type { MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import type { TradingEdition } from '@/trading/wiring/composition/edition'
import type { PublicBrief } from '@/trading/wiring/composition/public-brief'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import type { createDomainServices } from '@/trading/wiring/composition/services'
import type { TradingStores } from '@/trading/wiring/composition/stores'
import type { WithThemes } from '@/trading/wiring/composition/themes'
import type { OperationTick } from '@/trading/wiring/loop'
import { createPublicBriefTick } from '@/trading/features/brief/public/tick'
import { isVenueFillBooked } from '@/trading/features/ledger/sync'
import { runVenueSync } from '@/trading/features/ledger/sync-run'
import { renderMarketShow } from '@/trading/features/market-data/command/market'
import { createHeldWatch } from '@/trading/features/market-data/ops/held-watch'
import { createNavSnapshotTick } from '@/trading/features/portfolio/nav/snapshot'
import { offeredFields } from '@/trading/features/profile/patch'
import { sessionPhase } from '@/trading/markets/calendar'
import { NOTICE_SURFACE } from '@/trading/render/format'
import { buildAppViews } from '@/trading/wiring/composition/app-views'
import { createTradeableBook } from '@/trading/wiring/composition/delivery-reads'
import { toFocusScope } from '@/trading/wiring/composition/focus-scope'
import { toIntradayNext } from '@/trading/wiring/composition/intraday-next'
import { createPublicBrief, homeMarket } from '@/trading/wiring/composition/public-brief'
import { createPublicBriefGuard } from '@/trading/wiring/composition/public-brief-guard'
import { buildRebalanceViews } from '@/trading/wiring/composition/rebalance-views'
import { resolveMarketsInUse } from '@/trading/wiring/composition/refresh'
import { buildSuggestionCards } from '@/trading/wiring/composition/suggestion-cards'
import { createTradingDaemonTasks } from '@/trading/wiring/tasks'

interface Registries {
  readonly markets: MarketRegistry
  readonly venues: VenueRegistry
}

/** What the aggregate reads of the registration options. */
interface AggregateOptions {
  readonly tradingConfig: TradingConfig
  readonly sender: TradingNoticeSender
  readonly onFilled: OrderFilledListener
  readonly onAlertsChecked: (at: number) => void
  readonly onTaskPass: TaskPassListener
  readonly reachability: ReachabilityProbe
  /** `[schedule] late_grace_ms`: the one lateness bound a timed send shares with the scheduler. */
  readonly lateGraceMs: number
  readonly edition?: Pick<TradingEdition, 'profile' | 'rebalance' | 'screen'>
  /** Bound only where the public brief is switched on and can post. */
  readonly publicBrief?: PublicBriefPublisher
  recipient(): DeliveryAddress | undefined
}

interface AggregateParts {
  readonly services: ReturnType<typeof createDomainServices> & WithThemes
  readonly refresh: RefreshMarketData
  refreshMarketData(
    options: RefreshAllMarketDataOptions
  ): Promise<readonly RefreshMarketDataResult[]>
  macroExtractTick(policy: OperationPolicy): (signal: AbortSignal) => Promise<void>
  readonly stores: TradingStores
  createSuggestionBudget(): ReturnType<typeof createConfiguredRunBudget>
  readonly defaultLocale: Locale
  /** What decides a market is in use, shared with the sweep that refreshes them. */
  readonly inUse: Parameters<typeof resolveMarketsInUse>[0]
  readonly logger: Logger
}

/** The immutable public aggregate: the five services, the refresh function, and the daemon tasks.
 *  No registry, no store, no operation factory leaves this function. */
export function toAggregate(
  parts: AggregateParts,
  options: AggregateOptions,
  registries: Registries
): TradingServices {
  // The one owner of "the boot sweep is done": the loops wait on its promise, and the boot refresh
  // settles it through `releaseFirstSweep`.
  const firstSweep = Promise.withResolvers<void>()
  const publicBrief = toPublicBrief(parts, options, registries)

  return Object.freeze({
    ...parts.services,
    refresh: parts.refresh,
    refreshMarketData: parts.refreshMarketData,
    ...toMarketReads(parts.inUse),
    ...toIntradayNext({
      markets: registries.markets,
      config: options.tradingConfig,
      settings: parts.stores.intradaySettings,
    }),
    defaultRegion: options.tradingConfig.defaultRegion,
    focusScope: toFocusScope(parts.services.marketData.markets(), registries.markets),
    suggestionCards: buildSuggestionCards(parts.services, options.tradingConfig, parts.stores),
    rebalanceViews: buildRebalanceViews(
      parts.services,
      options.tradingConfig,
      options.edition?.rebalance
    ),
    profileFields: offeredFields(options.edition?.profile?.fields),
    appViews: buildAppViews(parts.services, options.tradingConfig, options.edition),
    publicBrief,
    daemonTasks: buildDaemonTasks(
      parts,
      {
        ...options,
        firstSweep: firstSweep.promise,
        publicBriefTick: toPublicBriefTick(parts, options, { publicBrief, registries }),
      },
      registries
    ),
    releaseFirstSweep: () => firstSweep.resolve(),
    syncVenue: buildVenueSync(parts, registries),
    marketSession: buildMarketSession(parts, options.tradingConfig, registries),
  })
}

function toPublicBrief(
  parts: AggregateParts,
  options: AggregateOptions,
  registries: Registries
): PublicBrief {
  return createPublicBrief({
    config: options.tradingConfig,
    markets: registries.markets,
    venues: registries.venues,
    marketData: parts.services.marketData,
    store: parts.stores.publicBrief,
    logger: parts.logger,
    refreshMarketData: parts.refreshMarketData,
  })
}

/** The same text `/market` prints, laid out as a notice is: in lines, at a phone's width. */
function buildMarketSession(
  parts: AggregateParts,
  config: TradingConfig,
  registries: Registries
): TradingServices['marketSession'] {
  const deps = {
    report: toReportDeps(parts, config, registries.venues),
    markets: registries.markets,
    config,
    settings: parts.stores.intradaySettings,
  }

  return (request) => renderMarketShow(deps, { ...request, surface: NOTICE_SURFACE })
}

/** The same function `/record sync` runs, so one fill is booked once whichever surface asks. */
function buildVenueSync(
  parts: AggregateParts,
  registries: Registries
): TradingServices['syncVenue'] {
  const deps = {
    portfolio: parts.services.portfolio,
    marketData: parts.services.marketData,
    venues: registries.venues,
    markets: registries.markets,
    ledger: parts.stores.ledger,
    logger: parts.logger,
  }

  return (input) => runVenueSync(deps, input)
}

function buildDaemonTasks(
  parts: AggregateParts,
  options: AggregateOptions & {
    readonly firstSweep: Promise<void>
    readonly publicBriefTick: OperationTick | undefined
  },
  registries: Registries
): TradingServices['daemonTasks'] {
  return createTradingDaemonTasks({
    config: options.tradingConfig,
    alerts: parts.services.alerts,
    suggestions: parts.services.suggestions,
    factorLog: parts.services.factorLog,
    navSnapshot: createNavSnapshotTick({
      portfolio: parts.services.portfolio,
      store: parts.stores.navSnapshot,
      timezone: options.tradingConfig.displayTimezone,
      logger: parts.logger,
    }),
    macroExtractTick: parts.macroExtractTick,
    themes: parts.services.themes,
    briefs: parts.services.briefs,
    markets: registries.markets,
    portfolio: parts.services.portfolio,
    reportDeps: toReportDeps(parts, options.tradingConfig, registries.venues),
    intradaySettings: parts.stores.intradaySettings,
    lateGraceMs: options.lateGraceMs,
    restingExit: parts.stores.restingExit,
    isFillBooked: (fill, signal) => isVenueFillBooked(parts.stores.ledger, fill, signal),
    venues: registries.venues,
    ...(parts.services.order === undefined ? {} : { order: parts.services.order }),
    sender: options.sender,
    heldWatch: buildHeldWatch(parts, options, registries),
    onFilled: options.onFilled,
    onAlertsChecked: options.onAlertsChecked,
    onTaskPass: options.onTaskPass,
    recipient: options.recipient,
    refreshMarketData: parts.refreshMarketData,
    firstSweep: options.firstSweep,
    logger: parts.logger,
    reachability: options.reachability,
    ...(options.publicBriefTick === undefined ? {} : { publicBrief: options.publicBriefTick }),
  })
}

/** The public brief's tick, where the brief can post: it builds, renders, judges and posts. The
 *  guard is the one reader of the book. */
function toPublicBriefTick(
  parts: AggregateParts,
  options: AggregateOptions,
  built: { readonly publicBrief: PublicBrief; readonly registries: Registries }
): OperationTick | undefined {
  const { publicBrief: publisher, tradingConfig } = options

  if (publisher === undefined) {
    return undefined
  }

  const { publicBrief, registries } = built
  const guard = createPublicBriefGuard(parts.services, parts.logger)

  return createPublicBriefTick({
    calendar: homeMarket(registries.markets).manifest.calendar,
    publishTime: tradingConfig.publicBrief.publishTime,
    store: parts.stores.publicBrief,
    publisher,
    logger: parts.logger,
    build: (input) => publicBrief.build(input),
    render: (row) => publicBrief.render(row),
    judge: (row, render, signal) => guard.judge(row, render, signal),
  })
}

/** The watch reads what the report reads - the tradeable book, the overview, the quote board - plus
 *  the plan stops and the archive, and tells the operator through the same sender. */
function buildHeldWatch(
  parts: AggregateParts,
  options: AggregateOptions,
  registries: Registries
): HeldWatch {
  const { marketData, alerts, portfolio } = parts.services
  const book = createTradeableBook({ portfolio, venues: registries.venues })

  return createHeldWatch({
    markets: registries.markets,
    region: options.tradingConfig.defaultRegion,
    reads: {
      tradeableHoldingsAt: book.tradeableHoldingsAt,
      quoteBoard: (request) => marketData.quoteBoard(request),
      stopDistances: (request) => alerts.stopDistances(request),
    },
    news: parts.stores.newsArchive,
    sender: options.sender,
    recipient: options.recipient,
    locale: parts.defaultLocale,
    logger: parts.logger,
  })
}

/** The intraday report names only what can still be traded: a sliver left by a full exit is no row. */
function toReportDeps(
  parts: {
    readonly services: ReturnType<typeof createDomainServices>
    readonly defaultLocale: Locale
  },
  config: TradingConfig,
  venues: VenueRegistry
): IntradayReportDeps {
  return {
    marketData: parts.services.marketData,
    book: createTradeableBook({ portfolio: parts.services.portfolio, venues }),
    profiles: parts.services.profiles,
    locale: parts.defaultLocale,
    timezone: config.displayTimezone,
  }
}

function toMarketReads(
  deps: Parameters<typeof resolveMarketsInUse>[0]
): Pick<TradingServices, 'marketsInUse' | 'isSessionOpen'> {
  const marketsInUse = (signal: AbortSignal): ReturnType<typeof resolveMarketsInUse> =>
    resolveMarketsInUse(deps, signal)

  return {
    marketsInUse,
    isSessionOpen: async (now, signal) =>
      isAnySessionOpen(deps.markets, await marketsInUse(signal), now),
  }
}

/** Whether any of these markets is trading, lunch break included. A continuous market (crypto) has
 *  no session to protect, and `pre-open` / `post-close` do not count: a VN trading day reads
 *  `pre-open` from midnight to the open, which would hold every night. */
function isAnySessionOpen(
  markets: MarketRegistry,
  refs: ReadonlySet<MarketRef>,
  now: number
): boolean {
  for (const ref of refs) {
    const calendar = markets.find(ref)?.manifest.calendar

    if (calendar === undefined || calendar.continuous) {
      continue
    }

    const phase = sessionPhase(calendar, now)

    if (phase === 'open' || phase === 'break') {
      return true
    }
  }

  return false
}
