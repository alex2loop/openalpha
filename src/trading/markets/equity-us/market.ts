import type { TradingConfig } from '@/trading/kernel/config'
import type { MarketDeps } from '@/trading/markets/deps'
import type { Market, MarketManifest } from '@/trading/markets/types'
import { US_EQUITY_FACTOR_IDS, US_ETF_FACTOR_IDS } from '@/trading/kernel/factor'
import { currencyCode, portfolioSegment, quoteUnit } from '@/trading/kernel/instrument'
import { MACRO_FORMULA_VERSION } from '@/trading/kernel/market/macro-series'
import { createTradingCalendar } from '@/trading/markets/calendar'
import { createUsBoardCache } from '@/trading/markets/equity-us/board'
import { usCapabilities } from '@/trading/markets/equity-us/capabilities'
import { detect, search, usCandidacy } from '@/trading/markets/equity-us/detect'
import { runUsFactors } from '@/trading/markets/equity-us/factors'
import { buildUsLevels } from '@/trading/markets/equity-us/levels'
import {
  US_ADMISSION,
  US_BENCHMARK_TICKER,
  US_BOARD_LOT,
  US_CALENDAR,
  US_EVIDENCE_SESSIONS,
  US_LEVEL_POLICY,
  US_MARKET_REF,
  US_MARKET_REGION,
  US_MINIMUM_RISK_REWARD,
  US_SETTLEMENT_SESSIONS,
  US_STRATEGY_VERSION,
  US_TICK,
} from '@/trading/markets/equity-us/policy'
import { createUsLeveragedFundStage } from '@/trading/markets/equity-us/stages/leveraged-fund'
import { FACTOR_SCORING_VERSION } from '@/trading/markets/factor-scoring'
import { strategyVersionOf } from '@/trading/markets/level-settings'
import { LEVEL_FORMULA_VERSION, trailOf } from '@/trading/markets/levels'
import { policyVersionOf } from '@/trading/markets/policy-version'

/** US stocks and ETFs are one market with several capabilities, not two: they share an exchange
 *  family, a currency, a calendar and one sizing formula. */
export function createUsEquityMarket(deps: MarketDeps): Market {
  const manifest = usManifest(deps.config)
  const board = createUsBoardCache(deps, manifest)

  deps.stages.register(createUsLeveragedFundStage(deps))

  return {
    manifest,
    capabilities: usCapabilities(deps, manifest, board),
    candidacy: usCandidacy,
    detect: (options) => detect(deps, options),
    search: (options) => search(deps, options),
    factors: (options) => runUsFactors({ deps, manifest, board }, options),
    levels: (options) => buildUsLevels(deps, options),
    ...trailOf(US_LEVEL_POLICY),
  }
}

export function usManifest(config: TradingConfig): MarketManifest {
  return {
    id: US_MARKET_REF,
    region: US_MARKET_REGION,
    assetClass: 'equity',
    segment: portfolioSegment('equity-us'),
    segmentCategory: 'stock',
    seedsDefaultTarget: 'home',
    currency: currencyCode('USD'),
    icon: '🇺🇸',
    quoteUnit: quoteUnit('currency-per-share'),
    defaultCalendar: US_CALENDAR,
    calendar: createTradingCalendar(US_CALENDAR, config.markets[US_MARKET_REF]),
    // The NYSE and Nasdaq regular session is what "a US trading day" means.
    ownsRegion: true,
    detection: 'stored',
    settlementSessions: US_SETTLEMENT_SESSIONS,
    evidenceSessions: US_EVIDENCE_SESSIONS,
    horizon: 'long',
    minimumRiskReward: US_MINIMUM_RISK_REWARD,
    boardLot: US_BOARD_LOT,
    tickSize: US_TICK,
    strategyVersion: strategyVersionOf(US_STRATEGY_VERSION, config.markets[US_MARKET_REF]),
    calculationVersions: [
      { name: 'factor-scoring', version: FACTOR_SCORING_VERSION },
      { name: 'levels', version: LEVEL_FORMULA_VERSION },
      { name: 'macro', version: MACRO_FORMULA_VERSION },
      policyVersionOf('equity-us'),
    ],
    // The union of both sets: stock and ETF factors are both user-visible.
    factorIds: [...new Set([...US_EQUITY_FACTOR_IDS, ...US_ETF_FACTOR_IDS])],
    playbook: {
      analysis: ['us-valuation', 'quality-screen'],
      execution: ['us-execution', 'us-market-rules'],
      fundAnalysis: ['macro-liquidity-analysis'],
    },
    // Both kinds screen, one at a time: the two composites are averages over different factors.
    screenableKinds: ['equity', 'etf'],
    benchmark: { market: US_MARKET_REF, ticker: US_BENCHMARK_TICKER },
    admission: US_ADMISSION,
  }
}
