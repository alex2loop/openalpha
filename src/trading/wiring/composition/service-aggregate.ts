import type { DaemonTask } from '@/core/container'
import type { Locale } from '@/core/types/locale'
import type { AlertService } from '@/trading/features/alerts/types'
import type { BriefService } from '@/trading/features/brief/types'
import type { VenueSyncOutcome } from '@/trading/features/ledger/sync-run'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { OrderService } from '@/trading/features/order/types'
import type { NavService } from '@/trading/features/portfolio/nav/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { ProfileService } from '@/trading/features/profile/types'
import type { SuggestionService } from '@/trading/features/suggestion/suggestion'
import type { FactorLogService } from '@/trading/features/suggestion/track-record/factor-log-types'
import type { MarketRef, Region, VenueRef } from '@/trading/kernel/instrument'
import type {
  RefreshAllMarketDataOptions,
  RefreshMarketDataOptions,
  RefreshMarketDataResult,
} from '@/trading/kernel/market/refresh'
import type { FocusScope } from '@/trading/kernel/operator/focus'
import type { AppViews } from '@/trading/wiring/composition/app-views'
import type { IntradayNext } from '@/trading/wiring/composition/intraday-next'
import type { RebalanceViews } from '@/trading/wiring/composition/rebalance-views'
import type { SuggestionCards } from '@/trading/wiring/composition/suggestion-cards'

/** The immutable aggregate every surface above trading consumes: the services above and the refresh
 *  function, never a registry, a store, or an operation factory. Declared here rather than beside
 *  its builder, which would close a host/registration cycle. Each service's own contract lives
 *  beside its domain types; this file only names the aggregate. */
export interface TradingServices {
  readonly marketData: MarketDataService
  readonly portfolio: PortfolioService
  readonly profiles: ProfileService
  readonly suggestions: SuggestionService
  /** The decision card an app shows for one stored suggestion, in the operator's language. */
  readonly suggestionCards: SuggestionCards
  /** The rebalance plan with the lines `/rebalance` prints for it, for an app surface. */
  readonly rebalanceViews: RebalanceViews
  /** The brief, the macro read and the track record with the CLI's lines for each. */
  readonly appViews: AppViews
  readonly factorLog: FactorLogService
  readonly nav: NavService
  readonly alerts: AlertService
  readonly briefs: BriefService
  /** Absent when the exchange credentials are not configured: the two order surfaces are not
   *  registered at all rather than registered and failing at first use. */
  readonly order?: OrderService
  refresh(options: RefreshMarketDataOptions): Promise<RefreshMarketDataResult>
  refreshMarketData(
    options: RefreshAllMarketDataOptions
  ): Promise<readonly RefreshMarketDataResult[]>
  /** What `/record sync` does: books the venue's fills the ledger lacks; places no order. */
  syncVenue(input: {
    readonly venue: VenueRef
    readonly locale: Locale
    readonly signal: AbortSignal
  }): Promise<VenueSyncOutcome>
  /** The markets something the operator relies on still reads (`composition/refresh.ts`). */
  marketsInUse(signal: AbortSignal): Promise<ReadonlySet<MarketRef>>
  /** Whether any market the operator relies on is trading right now. */
  isSessionOpen(now: number, signal: AbortSignal): Promise<boolean>
  /** Whether the intraday report is on and when it next fires. */
  nextIntraday(now: number, signal: AbortSignal): Promise<IntradayNext>
  readonly daemonTasks: readonly DaemonTask[]
  /** The configured default region. It lives on the aggregate so no surface carries a fallback of
   *  its own — a slash-command default and a route default that disagree are two products. */
  readonly defaultRegion: Region
  /** The markets this book trades and which of them keep sector data, for validating an agent's
   *  `[focus]` at boot. */
  readonly focusScope: FocusScope
}
