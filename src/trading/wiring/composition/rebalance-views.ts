import type { Locale } from '@/core/types/locale'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { RebalanceText } from '@/trading/features/portfolio/render/rebalance-surface'
import type { AbsoluteRebalancePlan, PortfolioService } from '@/trading/features/portfolio/types'
import type { ProfileService } from '@/trading/features/profile/types'
import type { TickerRequest } from '@/trading/kernel/instrument'
import { quoteConventionsFor } from '@/trading/features/market-data/command/quote-conventions'
import { renderRebalanceForSurface } from '@/trading/features/portfolio/render/rebalance-surface'
import { NOTICE_SURFACE, resolveRenderContext } from '@/trading/render/format'

export interface RebalanceView {
  readonly plan: AbsoluteRebalancePlan
  readonly text: RebalanceText
}

export interface RebalanceViews {
  plan(request: {
    readonly tickers?: readonly TickerRequest[]
    readonly locale: Locale
    readonly now: number
    readonly signal: AbortSignal
  }): Promise<RebalanceView>
}

interface RebalanceViewDeps {
  readonly portfolio: Pick<PortfolioService, 'rebalanceAbsolute'>
  readonly profiles: Pick<ProfileService, 'get'>
  readonly marketData: Pick<MarketDataService, 'quoteConvention'>
  readonly timezone: string
}

/** The plan and the lines `/rebalance` would print for it, written from the same options the
 *  command passes, so an app and the CLI cannot disagree about the same book. */
function createRebalanceViews(deps: RebalanceViewDeps): RebalanceViews {
  return {
    plan: async (request) => {
      const plan = await deps.portfolio.rebalanceAbsolute({
        now: request.now,
        signal: request.signal,
        ...(request.tickers === undefined ? {} : { tickers: request.tickers }),
      })
      const profile = await deps.profiles.get({
        signal: request.signal,
      })
      const instruments =
        plan.advice.kind === 'ready' ? plan.advice.rebalance.map((row) => row.instrument) : []

      return {
        plan,
        text: renderRebalanceForSurface(request.locale, plan, {
          context: resolveRenderContext(deps.timezone, NOTICE_SURFACE),
          ...(plan.freshness === undefined ? {} : { freshness: plan.freshness }),
          entryTranchePct: profile.entryTranchePct,
          maximumSectorPctNav: profile.maximumSectorPctNav,
          ...(plan.book === undefined
            ? {}
            : {
                book: plan.book,
                quoteConventions: quoteConventionsFor(deps.marketData, instruments),
              }),
        }),
      }
    },
  }
}

/** The view service over a built aggregate; the one line registration adds. */
export function buildRebalanceViews(
  services: Pick<RebalanceViewDeps, 'portfolio' | 'profiles' | 'marketData'>,
  config: { readonly displayTimezone: string }
): RebalanceViews {
  return createRebalanceViews({
    portfolio: services.portfolio,
    profiles: services.profiles,
    marketData: services.marketData,
    timezone: config.displayTimezone,
  })
}
