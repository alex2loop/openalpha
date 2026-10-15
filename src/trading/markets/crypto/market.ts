import type { TradingConfig } from '@/trading/kernel/config'
import type { FactorRequest, FactorScore } from '@/trading/kernel/factor'
import type {
  InstrumentRequest,
  InstrumentStatistics,
} from '@/trading/kernel/market/market-capability'
import type { Quote } from '@/trading/kernel/market/market-data'
import type { ScreenGateCode } from '@/trading/kernel/screen-codes'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { CryptoAssetEvidence } from '@/trading/markets/crypto/factors'
import type { MarketDeps } from '@/trading/markets/deps'
import type {
  Market,
  MarketCapabilities,
  MarketManifest,
  TradingCalendar,
} from '@/trading/markets/types'
import { CRYPTO_FACTOR_IDS } from '@/trading/kernel/factor'
import { currencyCode, portfolioSegment, quoteUnit } from '@/trading/kernel/instrument'
import { MACRO_FORMULA_VERSION } from '@/trading/kernel/market/macro-series'
import { available, unavailable } from '@/trading/kernel/source/source-result'
import { CONTINUOUS_CALENDAR, createTradingCalendar } from '@/trading/markets/calendar'
import { cryptoBars } from '@/trading/markets/crypto/bars'
import { cryptoCandidacy, detectCrypto } from '@/trading/markets/crypto/detect'
import { cryptoReduceSignal } from '@/trading/markets/crypto/exit'
import { cryptoFactorInputs, loadAssetEvidence } from '@/trading/markets/crypto/factors'
import { cryptoFunding } from '@/trading/markets/crypto/funding'
import { resolveCryptoMacroRisk } from '@/trading/markets/crypto/macro'
import { cryptoNews } from '@/trading/markets/crypto/news'
import { runCryptoOverview } from '@/trading/markets/crypto/overview'
import {
  BTC_TICKER,
  CRYPTO_ADMISSION,
  CRYPTO_BOARD_LOT,
  CRYPTO_EVIDENCE_SESSIONS,
  CRYPTO_FACTOR_POLICY,
  CRYPTO_LEVEL_POLICY,
  CRYPTO_LIQUIDITY_SESSIONS,
  CRYPTO_MARKET_REF,
  CRYPTO_MINIMUM_RISK_REWARD,
  CRYPTO_REGION,
  CRYPTO_STRATEGY_VERSION,
  CRYPTO_TICK,
  CRYPTO_VOLATILITY_SESSIONS,
} from '@/trading/markets/crypto/policy'
import { refreshCrypto } from '@/trading/markets/crypto/refresh'
import { cryptoFailedGates } from '@/trading/markets/crypto/screen'
import { evidenceWindow, runScreen } from '@/trading/markets/crypto/screen-run'
import { createCryptoCrowdingStage } from '@/trading/markets/crypto/stages/crowding'
import { createCryptoTapeSignalsStage } from '@/trading/markets/crypto/stages/tape-signals'
import { cryptoTapeReadings } from '@/trading/markets/crypto/tape/signals'
import { hasMinimumMarketCap, hasMinimumVolume } from '@/trading/markets/crypto/universe'
import { FACTOR_SCORING_VERSION, scoreFactors } from '@/trading/markets/factor-scoring'
import { resolveLevelPolicy, strategyVersionOf } from '@/trading/markets/level-settings'
import { buildLevels, LEVEL_FORMULA_VERSION, trailOf } from '@/trading/markets/levels'
import { statisticsFromCandles, statisticsSessions } from '@/trading/markets/statistics'
import { liveOrStoredQuote } from '@/trading/markets/stored-quote'

const STATS_SESSIONS = statisticsSessions(CRYPTO_LIQUIDITY_SESSIONS, CRYPTO_VOLATILITY_SESSIONS)

export function createCryptoMarket(deps: MarketDeps): Market {
  const manifest = cryptoManifest(deps.config)
  const levelPolicy = resolveLevelPolicy(
    CRYPTO_LEVEL_POLICY,
    deps.config.markets[CRYPTO_MARKET_REF]
  )

  deps.stages.register(createCryptoCrowdingStage())
  deps.stages.register(createCryptoTapeSignalsStage())

  return {
    manifest,
    capabilities: cryptoCapabilities(deps, manifest),
    candidacy: cryptoCandidacy,
    detect: (options) => detectCrypto(deps, options),
    factors: (options) => runFactors(deps, manifest, options),
    levels: (options) =>
      Promise.resolve(buildLevels({ ...options, policy: levelPolicy, tickSize: CRYPTO_TICK })),
    ...trailOf(CRYPTO_LEVEL_POLICY),
  }
}

function cryptoCapabilities(deps: MarketDeps, manifest: MarketManifest): MarketCapabilities {
  return {
    quote: {
      kind: 'quote',
      run: (request) => cryptoQuote(deps, request, manifest.calendar),
    },
    overview: {
      kind: 'overview',
      run: (request) =>
        runCryptoOverview({ deps, manifest, asOf: request.asOf, signal: request.signal }),
    },
    bars: {
      kind: 'bars',
      run: (request) => cryptoBars(deps, request, manifest.calendar),
    },
    sentiment: {
      kind: 'sentiment',
      run: (request) =>
        deps.sources.resolve({
          kind: 'sentiment',
          context: { market: CRYPTO_MARKET_REF },
          signal: request.signal,
        }),
    },
    news: { kind: 'news', run: (request) => cryptoNews(deps, request) },
    macroRisk: {
      kind: 'macroRisk',
      run: (request) => resolveCryptoMacroRisk(deps, manifest, request),
    },
    funding: {
      kind: 'funding',
      run: (request) => cryptoFunding(deps, request, manifest.calendar),
    },
    screen: { kind: 'screen', run: (request) => runScreen(deps, manifest, request) },
    statistics: {
      kind: 'statistics',
      run: (request) => cryptoStatistics(deps, manifest, request),
    },
    refresh: {
      kind: 'refresh',
      run: (request) => refreshCrypto(deps, manifest, request),
    },
  }
}

/** A venue that halts a pair keeps serving its last trade, well-formed and indefinitely, and no
 *  failover can detect that — the reading is then measured against a series a venue still trading
 *  the name publishes. One no fresher than the settled close is that close restated at best, so it
 *  is withheld rather than passed on as the price the market is making now. */
async function cryptoQuote(
  deps: MarketDeps,
  request: InstrumentRequest,
  calendar: TradingCalendar
): Promise<SourceResult<Quote>> {
  const quote = await deps.sources.resolve({
    kind: 'quote',
    context: { market: CRYPTO_MARKET_REF, instrument: request.instrument },
    signal: request.signal,
  })

  return liveOrStoredQuote({ deps, calendar, request, quote })
}

/** Crypto trades continuously and settles on-chain, so it reuses the shared continuous calendar and
 *  claims no region calendar — world gold already owns the global trading day. */
function cryptoManifest(config: TradingConfig): MarketManifest {
  const defaultCalendar = CONTINUOUS_CALENDAR

  return {
    id: CRYPTO_MARKET_REF,
    region: CRYPTO_REGION,
    assetClass: 'crypto',
    segment: portfolioSegment('crypto'),
    segmentCategory: 'crypto',
    currency: currencyCode('USDT'),
    icon: '₿',
    quoteUnit: quoteUnit('currency-per-coin'),
    defaultCalendar,
    calendar: createTradingCalendar(defaultCalendar, config.markets[CRYPTO_MARKET_REF]?.holidays),
    ownsRegion: false,
    detection: 'fetched',
    settlementSessions: 0,
    evidenceSessions: CRYPTO_EVIDENCE_SESSIONS,
    horizon: 'short',
    boardLot: CRYPTO_BOARD_LOT,
    tickSize: CRYPTO_TICK,
    strategyVersion: strategyVersionOf(CRYPTO_STRATEGY_VERSION, config.markets[CRYPTO_MARKET_REF]),
    calculationVersions: [
      { name: 'factor-scoring', version: FACTOR_SCORING_VERSION },
      { name: 'levels', version: LEVEL_FORMULA_VERSION },
      { name: 'macro', version: MACRO_FORMULA_VERSION },
    ],
    factorIds: CRYPTO_FACTOR_IDS,
    playbook: {
      analysis: ['crypto-analysis', 'macro-liquidity-analysis'],
      execution: ['crypto-execution'],
    },
    volumeGradesBreakout: true,
    minimumRiskReward: CRYPTO_MINIMUM_RISK_REWARD,
    // Every listed name is a coin, so narrowing to that kind is the identity — declared anyway so a
    // caller asking for the crypto board by kind is answered rather than refused.
    screenableKinds: ['crypto'],
    // What an altcoin is measured against: holding BTC is the alternative a crypto sleeve always has.
    benchmark: { market: CRYPTO_MARKET_REF, ticker: BTC_TICKER },
    admission: CRYPTO_ADMISSION,
  }
}

async function runFactors(
  deps: MarketDeps,
  manifest: MarketManifest,
  options: FactorRequest
): Promise<FactorScore> {
  const window = evidenceWindow(manifest.calendar, options)
  const evidence = await loadAssetEvidence(deps, { instrument: options.instrument, window })
  const inputs = cryptoFactorInputs(evidence)
  const signal = cryptoReduceSignal(evidence, inputs)
  const failed = admissionGatesOf(evidence)
  const signals = cryptoTapeReadings({
    candles: evidence.candles,
    ...(evidence.funding.value === undefined ? {} : { funding: evidence.funding.value }),
  })

  return {
    ...scoreFactors(inputs, CRYPTO_FACTOR_POLICY),
    ...(signal === undefined ? {} : { reduceSignal: signal }),
    ...(failed.length === 0 ? {} : { failedGates: failed }),
    ...(signals.length === 0 ? {} : { signals }),
  }
}

/** The screen's gates read off the evidence this run already loaded: the candle series answers the
 *  five candle gates, and the universe row the sweep returned answers both size floors. A row the
 *  provider did not return leaves the floors unjudged rather than failing them — an unmeasured size
 *  is not a small one. Size leads, the order `GATES` itself is written in and the order the screen
 *  reports a rejection in. */
function admissionGatesOf(evidence: CryptoAssetEvidence): readonly ScreenGateCode[] {
  const [record] = evidence.marketCap.value ?? []
  const sized: readonly ScreenGateCode[] =
    record === undefined
      ? []
      : [
          ...(hasMinimumMarketCap(record) ? [] : (['below-minimum-market-cap'] as const)),
          ...(hasMinimumVolume(record) ? [] : (['below-minimum-turnover'] as const)),
        ]

  return [...sized, ...cryptoFailedGates({ candles: evidence.candles })]
}

async function cryptoStatistics(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: InstrumentRequest
): Promise<SourceResult<InstrumentStatistics>> {
  const bars = await cryptoBars(deps, { ...request, sessions: STATS_SESSIONS }, manifest.calendar)

  if (bars.kind === 'unavailable') {
    return bars
  }

  const statistics = statisticsFromCandles(bars.value, {
    instrument: request.instrument,
    asOf: request.asOf,
    liquiditySessions: CRYPTO_LIQUIDITY_SESSIONS,
    volatilitySessions: CRYPTO_VOLATILITY_SESSIONS,
  })

  return statistics === null
    ? unavailable('unsupported', [])
    : available(statistics, bars.provenance, bars.caveats)
}
