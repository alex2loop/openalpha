import type { ToolDefinition } from '@/core/tool'
import type { AlertService } from '@/trading/features/alerts/types'
import type { BriefService } from '@/trading/features/brief/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { OrderService } from '@/trading/features/order/types'
import type { AgentPortfolio } from '@/trading/features/portfolio/types'
import type { AgentProfile } from '@/trading/features/profile/types'
import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import type { ThemeService } from '@/trading/features/themes/types'
import type { DefaultVenues, TradingCosts } from '@/trading/kernel/config'
import type { CurrencyCode } from '@/trading/kernel/instrument'
import { createAlertManageTool } from '@/trading/features/alerts/tools'
import { createBriefBuildTool, createBriefManageTool } from '@/trading/features/brief/tools'
import { createMarketAccountsTool } from '@/trading/features/market-data/tools/accounts'
import { createMarketBarsTool } from '@/trading/features/market-data/tools/bars'
import { createMarketEventsTool } from '@/trading/features/market-data/tools/events'
import { createVnForeignFlowTool } from '@/trading/features/market-data/tools/foreign-flow'
import { createMarketFundingTool } from '@/trading/features/market-data/tools/funding'
import { createVnFuturesBasisTool } from '@/trading/features/market-data/tools/futures-basis'
import { createMacroRiskTool } from '@/trading/features/market-data/tools/macro-risk'
import { createMarketNewsTool } from '@/trading/features/market-data/tools/news'
import { createMarketOverviewTool } from '@/trading/features/market-data/tools/overview'
import { createMarketPriceTool } from '@/trading/features/market-data/tools/price'
import { createMarketScreenTool } from '@/trading/features/market-data/tools/screen'
import { createMarketSectorStrengthTool } from '@/trading/features/market-data/tools/sector-strength'
import { createMarketSentimentTool } from '@/trading/features/market-data/tools/sentiment'
import { createOrderExitsTool, createOrderPlaceTool } from '@/trading/features/order/tools'
import { createPortfolioHistoryTool } from '@/trading/features/portfolio/tools/history'
import {
  ledgerDraftInput,
  ledgerEditDraftInput,
  profilePatchInput,
} from '@/trading/features/portfolio/tools/input'
import { createPortfolioRebalanceTool } from '@/trading/features/portfolio/tools/rebalance'
import { createPortfolioRecordTool } from '@/trading/features/portfolio/tools/record'
import { createPortfolioRemoveTool } from '@/trading/features/portfolio/tools/remove'
import { createPortfolioReviewTool } from '@/trading/features/portfolio/tools/review'
import { createPortfolioUpdateTool } from '@/trading/features/portfolio/tools/update'
import { createPortfolioViewTool } from '@/trading/features/portfolio/tools/view'
import { createWatchlistUpdateTool } from '@/trading/features/portfolio/tools/watchlist-update'
import { createProfileTools } from '@/trading/features/profile/tools'
import { suggestionReportDeps } from '@/trading/features/suggestion/report'
import { createSuggestionBatchTool } from '@/trading/features/suggestion/tools/batch'
import { createSuggestionRunTool } from '@/trading/features/suggestion/tools/run'
import { createSuggestionTrackRecordTool } from '@/trading/features/suggestion/tools/track-record'
import { createThemesViewTool } from '@/trading/features/themes/tools/view'
import {
  type MarketSchema,
  marketInput,
  regionInput,
  tickerInput,
} from '@/trading/kernel/surface/surface'

/** The five workflow services are the whole tool surface: no tool receives a store, a registry, or
 *  a resolver. The portfolio member is the feature's own `AgentPortfolio` narrowing, so the two
 *  absolute-money reads are not even representable to an agent. */
interface TradingToolDeps {
  readonly marketData: MarketDataService
  readonly portfolio: AgentPortfolio
  readonly profiles: AgentProfile
  readonly suggestions: SuggestionService
  readonly alerts: AlertService
  readonly briefs: BriefService
  readonly themes: ThemeService
  readonly costs: TradingCosts
  readonly defaultVenues: DefaultVenues
  /** Cash is booked in the book's own currency, so the draft schema never asks for one. */
  readonly baseCurrency: CurrencyCode
  /** The operator's clock, for rendering a tool's operator-facing copy. */
  readonly displayTimezone: string
  /** Absent when the exchange credentials are not configured, in which case the model is not
   *  offered a tool that can only fail. */
  readonly order?: OrderService
}

export function createTradingTools(deps: TradingToolDeps): readonly ToolDefinition[] {
  const { alerts, briefs, marketData, portfolio, profiles } = deps
  const markets = marketInput(marketData.markets())
  const regions = regionInput(marketData.regions())
  const draftScope = {
    markets,
    venues: portfolio,
    quotes: marketData,
    baseCurrency: deps.baseCurrency,
  }
  const draft = ledgerDraftInput(draftScope)
  const editDraft = ledgerEditDraftInput(draftScope)
  const ledgerToolDeps = {
    portfolio,
    markets: marketData,
    costs: deps.costs,
    baseCurrency: deps.baseCurrency,
  }

  return [
    createMarketPriceTool(marketData, markets),
    createMarketBarsTool(marketData, markets),
    createMarketOverviewTool(marketData),
    createMarketEventsTool(marketData, markets),
    createMacroRiskTool(marketData, regions),
    createMarketScreenTool(marketData, markets),
    createMarketSectorStrengthTool(marketData, markets),
    createMarketSentimentTool(marketData, markets),
    createMarketFundingTool(marketData, markets),
    createMarketAccountsTool(marketData, markets),
    createVnForeignFlowTool(marketData),
    createVnFuturesBasisTool(marketData),
    createMarketNewsTool(marketData, markets, regions),
    createPortfolioViewTool(portfolio),
    createPortfolioHistoryTool(portfolio),
    createPortfolioReviewTool(portfolio),
    createPortfolioRebalanceTool(portfolio),
    ...createProfileTools(profiles, profilePatchInput(markets)),
    createWatchlistUpdateTool(profiles),
    createPortfolioRecordTool({ ...ledgerToolDeps, draft }),
    createPortfolioUpdateTool({ ...ledgerToolDeps, draft: editDraft }),
    createPortfolioRemoveTool(ledgerToolDeps),
    ...suggestionTools(deps, markets),
    createAlertManageTool(alerts, markets),
    createBriefBuildTool(briefs, regions, deps.displayTimezone),
    createBriefManageTool(briefs, regions),
    createThemesViewTool(deps.themes),
    ...orderTools(deps),
  ]
}

function suggestionTools(deps: TradingToolDeps, markets: MarketSchema): readonly ToolDefinition[] {
  const { suggestions, marketData } = deps
  const reportDeps = suggestionReportDeps(deps, deps)

  return [
    createSuggestionRunTool(reportDeps, markets),
    createSuggestionBatchTool(suggestions, markets, { marketData }),
    createSuggestionTrackRecordTool(suggestions, marketData),
  ]
}

/** Offered only where exchange credentials are configured: a tool that can only fail is not offered. */
function orderTools(deps: TradingToolDeps): readonly ToolDefinition[] {
  const { order, marketData } = deps

  return order === undefined
    ? []
    : [createOrderPlaceTool(order, tickerInput), createOrderExitsTool(order, marketData)]
}
