import type { TradingConfig } from '@/trading/kernel/config'
import type { MarketDeps } from '@/trading/markets/deps'
import type { Market, MarketManifest } from '@/trading/markets/types'
import { VN_EQUITY_FACTOR_IDS, VN_ETF_FACTOR_IDS } from '@/trading/kernel/factor'
import { currencyCode, portfolioSegment, quoteUnit, ticker } from '@/trading/kernel/instrument'
import { createTradingCalendar } from '@/trading/markets/calendar'
import { vnCapabilities } from '@/trading/markets/equity-vn/capabilities'
import { candidacy, detect, search } from '@/trading/markets/equity-vn/detect'
import { crossSectionCache } from '@/trading/markets/equity-vn/evidence/cross-section-cache'
import { buildVnLevels } from '@/trading/markets/equity-vn/levels'
import {
  BOARD_LOT,
  HOSE_SHARE_TICK,
  SETTLEMENT_SESSIONS,
  VN_ADMISSION,
  VN_BOARD_PRICE_DISPLAY,
  VN_CALENDAR,
  VN_CEILING_TRIM_POLICY,
  VN_EVIDENCE_SESSIONS,
  VN_INDEX_TICKER,
  VN_LEVEL_POLICY,
  VN_MACRO_FORMULA_VERSION,
  VN_MARKET_REF,
  VN_MARKET_REGION,
  VN_MINIMUM_RISK_REWARD,
  VN_STRATEGY_VERSION,
} from '@/trading/markets/equity-vn/policy'
import { runFactors } from '@/trading/markets/equity-vn/run-factors'
import { createVnDisclosureStage } from '@/trading/markets/equity-vn/stages/disclosure'
import { createVnDistributionStage } from '@/trading/markets/equity-vn/stages/distribution'
import { createVnIndexReviewStage } from '@/trading/markets/equity-vn/stages/index-review'
import { createVnSolvencyStage } from '@/trading/markets/equity-vn/stages/solvency'
import { createVnTapeSignalsStage } from '@/trading/markets/equity-vn/stages/tape-signals'
import { resolveVnTickSize, VN_PRICE_LIMIT } from '@/trading/markets/equity-vn/tradeability'
import { FACTOR_SCORING_VERSION } from '@/trading/markets/factor-scoring'
import { strategyVersionOf } from '@/trading/markets/level-settings'
import { LEVEL_FORMULA_VERSION, trailOf } from '@/trading/markets/levels'

/** VN stocks, VN ETFs, and VN30 futures-basis research are one market with several capabilities,
 *  not three markets: they share an exchange, a currency, a calendar, a board lot, and one sizing
 *  formula. Splitting them would need three `(region, assetClass)` owners for one exchange, which
 *  the market isolation key forbids. */
export function createVnEquityMarket(deps: MarketDeps): Market {
  const manifest = vnManifest(deps.config)
  const crossSection = crossSectionCache(deps, manifest)

  deps.stages.register(createVnSolvencyStage(crossSection))
  deps.stages.register(createVnDistributionStage(deps))
  deps.stages.register(createVnDisclosureStage(crossSection))
  deps.stages.register(createVnIndexReviewStage())
  deps.stages.register(createVnTapeSignalsStage())

  return {
    manifest,
    capabilities: vnCapabilities(deps, manifest, crossSection),
    candidacy,
    detect: (options) => detect(deps, options),
    search: (options) => search(deps, options),
    factors: (options) => runFactors(crossSection, options, VN_CEILING_TRIM_POLICY.sessions),
    levels: async (options) =>
      buildVnLevels(deps, await crossSection.get(options.asOf, options.signal), options),
    ...trailOf(VN_LEVEL_POLICY),
    priceLimit: VN_PRICE_LIMIT,
    // The grid is the listing's: HNX and funds do not trade on the HOSE table the manifest names.
    tickSizeOf: (request) => resolveVnTickSize(deps, request),
  }
}

function vnManifest(config: TradingConfig): MarketManifest {
  return {
    id: VN_MARKET_REF,
    region: VN_MARKET_REGION,
    assetClass: 'equity',
    segment: portfolioSegment('equity-vn'),
    segmentCategory: 'stock',
    seedsDefaultTarget: 'home',
    currency: currencyCode('VND'),
    icon: '🇻🇳',
    quoteUnit: quoteUnit('currency-per-share'),
    defaultCalendar: VN_CALENDAR,
    calendar: createTradingCalendar(VN_CALENDAR, config.markets[VN_MARKET_REF]?.holidays),
    // HOSE's session is what "a Vietnamese trading day" means.
    ownsRegion: true,
    detection: 'stored',
    settlementSessions: SETTLEMENT_SESSIONS,
    evidenceSessions: VN_EVIDENCE_SESSIONS,
    horizon: 'long',
    minimumRiskReward: VN_MINIMUM_RISK_REWARD,
    boardLot: BOARD_LOT,
    tickSize: HOSE_SHARE_TICK,
    priceDisplay: VN_BOARD_PRICE_DISPLAY,
    strategyVersion: strategyVersionOf(VN_STRATEGY_VERSION, config.markets[VN_MARKET_REF]),
    calculationVersions: [
      { name: 'factor-scoring', version: FACTOR_SCORING_VERSION },
      { name: 'levels', version: LEVEL_FORMULA_VERSION },
      { name: 'macro', version: VN_MACRO_FORMULA_VERSION },
    ],
    // The union of both sets: stock and ETF factors are both user-visible.
    factorIds: [...new Set([...VN_EQUITY_FACTOR_IDS, ...VN_ETF_FACTOR_IDS])],
    playbook: {
      analysis: ['vn-valuation', 'quality-screen'],
      execution: ['vn-execution', 'vn-market-rules'],
    },
    // Both kinds screen, one at a time: the board defaults to equities and a fund board is asked
    // for by kind, because the two composites are averages over different factor counts.
    screenableKinds: ['equity', 'etf'],
    benchmark: { market: VN_MARKET_REF, ticker: ticker(VN_INDEX_TICKER) },
    admission: VN_ADMISSION,
  }
}
