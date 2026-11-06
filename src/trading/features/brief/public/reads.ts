import type { PublicBriefStore } from '@/trading/features/brief/public/types'
import type { BriefServices } from '@/trading/features/brief/types'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { TrackRecordReport } from '@/trading/features/suggestion/track-record/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import { marketRef } from '@/trading/kernel/instrument'

/** The market that composes the public brief and dates it. */
export const PUBLIC_HOME_MARKET = marketRef('equity-vn')

/** The markets the public brief always reads, whatever the operator holds or has switched off. */
export const PUBLIC_BRIEF_MARKETS: readonly MarketRef[] = Object.freeze([
  PUBLIC_HOME_MARKET,
  marketRef('gold-vn'),
  marketRef('gold'),
  marketRef('crypto'),
])

/** The one market the brief reads only while the operator's segment for it is on. Its board ranks
 *  the names the operator follows, so every public read of it is `followedBlind`. */
export const PUBLIC_US_MARKET = marketRef('equity-us')

/** No call has resolved on a book that holds nothing. */
const EMPTY_REPORT: TrackRecordReport = {
  summary: {
    resolvedCount: 0,
    resolvedNameCount: 0,
    winCount: 0,
    lossCount: 0,
    benchmarkComparedCount: 0,
    benchmarkBeatCount: 0,
    versions: [],
    debateModels: [],
    focuses: [],
    calibration: [],
    reviewSplits: [],
    shadow: { totalContribution: 0, worstDrawdown: 0, sizedCount: 0, unsizedCount: 0, caveats: [] },
    coverage: {
      actionable: 0,
      resolved: 0,
      pending: 0,
      unresolvable: 0,
      restated: 0,
      unfilled: 0,
    },
    caveats: [],
  },
  recent: [],
}

/** Every market the brief reads: the fixed ones, and the US one when its segment is on. */
export function publicBriefMarkets(withUs: boolean): readonly MarketRef[] {
  return withUs ? [...PUBLIC_BRIEF_MARKETS, PUBLIC_US_MARKET] : PUBLIC_BRIEF_MARKETS
}

interface PublicBriefReadsInput {
  readonly marketData: MarketDataService
  /** The markets the market reads name, as `publicBriefMarkets` resolved them for this build. */
  readonly markets: readonly MarketRef[]
  readonly store: PublicBriefStore
  /** The seeded default profile with an empty watchlist: the reads state no limit of the operator's. */
  readonly profile: UserProfile
}

/** The brief's reads with no book behind them. A read of the operator's holdings, watchlist, alerts
 *  or suggestions answers empty, and the market reads name the resolved public markets, never the
 *  markets the operator uses. The previous brief is the public one. */
export function createPublicBriefReads(input: PublicBriefReadsInput): BriefServices {
  const { marketData, store, profile, markets } = input

  return {
    holdings: () => Promise.resolve([]),
    listResolvedSuggestions: () => Promise.resolve([]),
    listFiredAlerts: () => Promise.resolve([]),
    runSuggestions: () => Promise.resolve([]),
    positionExits: () => Promise.resolve([]),
    unwatchedPositions: () => Promise.resolve([]),
    stalePositions: () => Promise.resolve([]),
    stopDistances: () => Promise.resolve(undefined),
    bookSummary: () => Promise.resolve(null),
    rebalance: () =>
      Promise.resolve({ kind: 'unavailable', reason: 'zero-nav', findings: [], caveats: [] }),
    profile: () => Promise.resolve(profile),
    summarize: () => Promise.resolve(EMPTY_REPORT),
    overview: (options) => marketData.overview({ ...options, markets, followedBlind: true }),
    marketNews: (options) => marketData.newsPerMarket({ ...options, markets }),
    quoteBoard: (options) => marketData.quoteBoard(options),
    basis: (options) => marketData.basis(options),
    macroNews: (options) => marketData.macroNews(options),
    economyNews: (options) => marketData.economyNews(options),
    previousSections: async (options) =>
      (await store.findPrevious(options.before, options.signal))?.sections ?? null,
  }
}
