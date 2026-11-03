import type { AlertService } from '@/trading/features/alerts/types'
import type { BriefServices } from '@/trading/features/brief/types'
import type { ScreenForm } from '@/trading/features/market-data/types'
import type { RebalanceForm, ReduceVerdicts } from '@/trading/features/portfolio/types'
import type { SuggestAnalysis } from '@/trading/features/suggestion/command'
import type { ExitPlanner } from '@/trading/features/suggestion/exit-plan/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { RefreshDataKind } from '@/trading/kernel/market/refresh'
import type { BriefActionCode, BriefSectionKind } from '@/trading/kernel/operator/brief-section'

/** The reads of a book that holds no suggestion and plans no exit: each answers empty, which every
 *  reader takes as absent, never as zero. They are the verdict the book would close a name on, the
 *  plan written when a trade is recorded, the stop distances the portfolio lists, and what the
 *  brief reads of the same: its sweep over the operator's names, resolved calls, fired alerts and
 *  exit watch. */
export interface BookReads {
  readonly reduceVerdicts: ReduceVerdicts
  readonly exitPlans: ExitPlanner
  readonly stopDistances: Pick<AlertService, 'stopDistances'>
  readonly brief: Pick<
    BriefServices,
    | 'runSuggestions'
    | 'listResolvedSuggestions'
    | 'listFiredAlerts'
    | 'positionExits'
    | 'unwatchedPositions'
    | 'stalePositions'
  >
}

/** What an edition that is not the installed version narrows. Every field absent is the installed
 *  version: all five markets, every command, the stored verdicts and the full suggestion pipeline.
 *  An edition states its own value for the ones it changes, so no consumer tests which edition runs. */
export interface TradingEdition {
  /** The markets built; every other market is as if it never shipped. */
  readonly markets?: ReadonlySet<MarketRef>
  /** The slash commands offered, by name. */
  readonly commands?: ReadonlySet<string>
  /** `/suggest` where the full pipeline is not offered. */
  readonly suggest?: SuggestAnalysis
  /** How a rebalance plan is written: as orders, or as the gaps to the plan. */
  readonly rebalance?: RebalanceForm
  /** How a screen answers: the best names ranked, or every priced name for the reader to sort. */
  readonly screen?: ScreenForm
  /** Brief sections left out: each reads as omitted, which every surface already hides. */
  readonly briefOmits?: ReadonlySet<BriefSectionKind>
  /** Next actions the brief never lists, whatever fired them: each reads as if it never fired. */
  readonly briefActionOmits?: ReadonlySet<BriefActionCode>
  /** What an edition that stores no suggestion and plans no exit answers itself. */
  readonly reads?: BookReads
  /** See `MarketDeps.pagedBackfill`. */
  readonly pagedBackfill?: true
  /** Data kinds a refresh leaves out because no source serves them. */
  readonly refreshOmits?: ReadonlySet<RefreshDataKind>
}

/** Whether an edition builds `market`: every market, unless it names the ones it ships. */
export function isMarketBuilt(edition: TradingEdition | undefined, market: MarketRef): boolean {
  return edition?.markets === undefined || edition.markets.has(market)
}
