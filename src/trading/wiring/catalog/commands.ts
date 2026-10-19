import type { Logger } from '@/core/logging/logger'
import type { CommandGroup, SlashCommand } from '@/core/types/command'
import type { AlertService } from '@/trading/features/alerts/types'
import type { BriefService } from '@/trading/features/brief/types'
import type { LedgerStore } from '@/trading/features/ledger/store/ledger'
import type { IntradaySettingsStore } from '@/trading/features/market-data/store/intraday-settings'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { OrderService } from '@/trading/features/order/types'
import type { NavService } from '@/trading/features/portfolio/nav/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { ProfileService } from '@/trading/features/profile/types'
import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import type { FactorLogService } from '@/trading/features/suggestion/track-record/factor-log-types'
import type { ThemeService } from '@/trading/features/themes/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type { MarketRef, Region } from '@/trading/kernel/instrument'
import type { MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import type { TradingServices } from '@/trading/wiring/composition/service-aggregate'
import { createAlertCommand } from '@/trading/features/alerts/command'
import { createBriefCommand } from '@/trading/features/brief/command'
import { createRecordCommand } from '@/trading/features/ledger/command'
import { createDeleteCommand, createUpdateCommand } from '@/trading/features/ledger/edit'
import { createStagedRecords } from '@/trading/features/ledger/staged'
import { createTransactionsCommand } from '@/trading/features/ledger/transactions'
import { createMarketCommand } from '@/trading/features/market-data/command/market'
import { createOverviewCommand } from '@/trading/features/market-data/command/overview'
import { createPriceCommand } from '@/trading/features/market-data/command/price'
import { createRefreshCommand } from '@/trading/features/market-data/command/refresh'
import { createScreenCommand } from '@/trading/features/market-data/command/screen'
import { createSourcesCommand } from '@/trading/features/market-data/command/sources'
import { createTradeCommand } from '@/trading/features/order/command'
import { createPortfolioCommand } from '@/trading/features/portfolio/command/portfolio'
import { createRebalanceCommand } from '@/trading/features/portfolio/command/rebalance'
import { createReconcileCommand } from '@/trading/features/portfolio/command/reconcile'
import { createWatchlistCommand } from '@/trading/features/portfolio/command/watchlist'
import { createProfileCommand } from '@/trading/features/profile/command'
import { createSuggestCommand } from '@/trading/features/suggestion/command'
import { suggestionReportDeps } from '@/trading/features/suggestion/report'
import { createReflectCommand } from '@/trading/features/suggestion/track-record/command'
import { createThemesCommand } from '@/trading/features/themes/command'
import { SECTION_ICONS } from '@/trading/render/format'
import { createSetupCommand } from '@/trading/wiring/catalog/setup'
import { resolveRefreshMarkets } from '@/trading/wiring/composition/refresh'

const BOOK_GROUP: CommandGroup = Object.freeze({
  key: 'slash.tradingGroupBook',
  icon: SECTION_ICONS.portfolio,
})
const MARKET_GROUP: CommandGroup = Object.freeze({
  key: 'slash.tradingGroupMarket',
  icon: SECTION_ICONS.overview,
})
const ANALYSIS_GROUP: CommandGroup = Object.freeze({
  key: 'slash.tradingGroupAnalysis',
  icon: SECTION_ICONS.suggestion,
})

interface TradingCommandDeps {
  readonly themes: ThemeService
  readonly portfolio: Pick<
    PortfolioService,
    | 'record'
    | 'previewRecord'
    | 'update'
    | 'remove'
    | 'viewAbsolute'
    | 'viewAbsoluteWithKinds'
    | 'historyAbsolute'
    | 'rebalance'
    | 'rebalanceAbsolute'
    | 'positionsAt'
    | 'reconcile'
  >
  readonly nav: Pick<NavService, 'history'>
  readonly profiles: ProfileService
  readonly marketData: Pick<
    MarketDataService,
    | 'quote'
    | 'screen'
    | 'macroRisk'
    | 'regions'
    | 'quoteBoard'
    | 'markets'
    | 'screenableKinds'
    | 'quoteConvention'
    | 'instrumentQuoteConvention'
    | 'minimumRiskReward'
    | 'boardLot'
    | 'trailsStop'
    | 'overview'
    | 'describeMarkets'
    | 'events'
    | 'listSources'
  >
  readonly suggestions: Pick<
    SuggestionService,
    'run' | 'runBatch' | 'summarize' | 'reflect' | 'focusRecords' | 'listResolved' | 'get'
  >
  readonly factorLog: Pick<FactorLogService, 'listResolved'>
  readonly alerts: AlertService
  readonly briefs: BriefService
  readonly refreshMarketData: TradingServices['refreshMarketData']
  readonly markets: MarketRegistry
  readonly venues: VenueRegistry
  readonly config: TradingConfig
  readonly intradaySettings: IntradaySettingsStore
  readonly ledger: Pick<
    LedgerStore,
    'listAll' | 'findById' | 'findByIdempotency' | 'listIdsMatching'
  >
  readonly logger: Logger
  readonly defaultRegion: Region
  /** Absent when no exchange key is configured: `/trade` then only names the keys it needs. */
  readonly order?: OrderService
}

export function createTradingCommands(deps: TradingCommandDeps): readonly SlashCommand[] {
  const { alerts, defaultRegion, marketData, portfolio, profiles } = deps
  const timezone = deps.config.displayTimezone
  const costs = deps.config.costs

  return [
    ...inGroup(BOOK_GROUP, [
      createSetupCommand(),
      ...ledgerWriteCommands(deps),
      ...bookCommands(deps),
      createTransactionsCommand({
        portfolio,
        marketData,
        ledger: deps.ledger,
        markets: deps.markets,
        defaultRegion,
        baseCurrency: deps.config.baseCurrency,
      }),
      createAlertCommand({ alerts, markets: deps.markets, marketData }),
      createTradeCommand({
        marketData,
        costs,
        timezone,
        venues: deps.venues,
        ...(deps.order === undefined ? {} : { order: deps.order }),
      }),
    ]),
    ...inGroup(MARKET_GROUP, marketCommands(deps)),
    ...inGroup(ANALYSIS_GROUP, [
      ...suggestionCommands(deps),
      createBriefCommand({ briefs: deps.briefs, defaultRegion, timezone }),
      createThemesCommand({ themes: deps.themes, timezone }),
      createProfileCommand({ profiles, timezone }),
    ]),
  ]
}

function marketCommands(deps: TradingCommandDeps): readonly SlashCommand[] {
  const { defaultRegion, marketData, portfolio, profiles } = deps
  const timezone = deps.config.displayTimezone

  return [
    createPriceCommand({ marketData, timezone }),
    createOverviewCommand({
      marketData,
      defaultRegion,
      timezone,
      heldMarkets: deps.venues.heldMarkets(),
    }),
    createMarketCommand({
      report: { marketData, book: portfolio, profiles, timezone },
      markets: deps.markets,
      config: deps.config,
      settings: deps.intradaySettings,
    }),
    createScreenCommand({ marketData, timezone, ...screenDefaultMarket(deps) }),
    createRefreshCommand({
      refreshMarketData: deps.refreshMarketData,
      markets: resolveRefreshMarkets(deps.markets),
      registered: deps.markets.list().map((market) => market.manifest.id),
      timezone,
    }),
    createSourcesCommand({ marketData, timezone }),
  ]
}

/** The `/help` heading a run of commands lists under. */
function inGroup(group: CommandGroup, commands: readonly SlashCommand[]): readonly SlashCommand[] {
  return commands.map((command) => ({ ...command, group }))
}

/** The four the portfolio feature owns: what the book holds, what to change, what settled where,
 *  and the names watched. The order path reaches only this group - it is what tells a stop a plan
 *  intends from one standing at an exchange, and an install with no venue has neither. */
function bookCommands(deps: TradingCommandDeps): readonly SlashCommand[] {
  const { alerts, marketData, nav, portfolio, profiles, venues } = deps
  const timezone = deps.config.displayTimezone
  const orders = deps.order === undefined ? {} : { orders: deps.order }

  return [
    createPortfolioCommand({
      portfolio,
      nav,
      profiles,
      marketData,
      timezone,
      alerts,
      venues,
      ...orders,
    }),
    createRebalanceCommand({
      portfolio,
      profiles,
      marketData,
      timezone,
      heldMarkets: deps.venues.heldMarkets(),
    }),
    createReconcileCommand({ portfolio, timezone }),
    createWatchlistCommand({ profiles, marketData, timezone }),
  ]
}

/** The three commands that write a ledger row. `/record` alone reaches the venue — its `sync` arm
 *  books what the exchange filled — so only it carries the registries and the store. */
function ledgerWriteCommands(deps: TradingCommandDeps): readonly SlashCommand[] {
  const { portfolio, marketData, markets, venues, ledger, logger } = deps
  const costs = deps.config.costs
  const policy = deps.config.ledger
  const staged = createStagedRecords({
    ttlMs: policy.confirmTtlMs,
    max: policy.maximumStagedRecords,
  })
  const baseCurrency = deps.config.baseCurrency

  return [
    createRecordCommand({
      portfolio,
      marketData,
      costs,
      venues,
      markets,
      ledger,
      logger,
      staged,
      baseCurrency,
      policy,
    }),
    createUpdateCommand({ portfolio, marketData, costs, baseCurrency }),
    createDeleteCommand({ portfolio, marketData, costs, ledger }),
  ]
}

/** The two that read the suggestion store. `/reflect` carries the ledger as well, because scoring a
 *  call compares its suggested entry against the fill the operator actually got. */
function suggestionCommands(deps: TradingCommandDeps): readonly SlashCommand[] {
  const { alerts, marketData, profiles, suggestions } = deps

  return [
    createSuggestCommand({
      ...suggestionReportDeps({ suggestions, marketData, profiles }, deps.config),
      coverage: alerts,
      venues: deps.venues,
    }),
    createReflectCommand({ suggestions, factorLog: deps.factorLog }),
  ]
}

/** The market a bare `/screen` reads: the one that speaks for the operator's own region, which is
 *  the same rule `/brief` follows. A region with no owner contributes nothing, and the command
 *  keeps asking for the market by name. */
function screenDefaultMarket(deps: TradingCommandDeps): { defaultMarket?: MarketRef } {
  const owner = deps.markets.regionOwner(deps.defaultRegion)

  return owner === null ? {} : { defaultMarket: owner.manifest.id }
}
