import type { TradingConfig } from '@/trading/kernel/config'
import type { InstrumentRef, Ticker } from '@/trading/kernel/instrument'
import type {
  BarsRequest,
  InstrumentRequest,
  InstrumentStatistics,
} from '@/trading/kernel/market/market-capability'
import type { Candle, Quote } from '@/trading/kernel/market/market-data'
import type { SourceContext, SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type {
  Market,
  MarketDetection,
  MarketManifest,
  TickerCandidacy,
} from '@/trading/markets/types'
import { GOLD_FACTOR_IDS } from '@/trading/kernel/factor'
import { currencyCode, portfolioSegment, quoteUnit } from '@/trading/kernel/instrument'
import { MACRO_FORMULA_VERSION } from '@/trading/kernel/market/macro-series'
import { available, unavailable } from '@/trading/kernel/source/source-result'
import { settledBars } from '@/trading/markets/bars'
import { createTradingCalendar } from '@/trading/markets/calendar'
import { FACTOR_SCORING_VERSION, scoreFactors } from '@/trading/markets/factor-scoring'
import { goldFactorInputs, loadGoldEvidence } from '@/trading/markets/gold/factors'
import { runGoldOverview } from '@/trading/markets/gold/overview'
import {
  EVIDENCE_SESSIONS,
  FACTOR_POLICY,
  GOLD_BOARD_LOT,
  GOLD_LEVEL_POLICY,
  GOLD_LIQUIDITY_SESSIONS,
  GOLD_MARKET_REF,
  GOLD_MINIMUM_RISK_REWARD,
  GOLD_REGION,
  GOLD_STRATEGY_VERSION,
  GOLD_VOLATILITY_SESSIONS,
  WORLD_GOLD_CALENDAR,
  WORLD_GOLD_REF,
  WORLD_TICK,
} from '@/trading/markets/gold/policy'
import { resolveLevelPolicy, strategyVersionOf } from '@/trading/markets/level-settings'
import { buildLevels, LEVEL_FORMULA_VERSION, trailOf } from '@/trading/markets/levels'
import { resolveMacroRisk } from '@/trading/markets/macro'
import { statisticsFromCandles, statisticsSessions } from '@/trading/markets/statistics'

const GOLD_ALIASES: ReadonlySet<string> = new Set(['XAU', 'XAUUSD', 'GOLD'])
const STATS_SESSIONS = statisticsSessions(GOLD_LIQUIDITY_SESSIONS, GOLD_VOLATILITY_SESSIONS)

export function createGoldMarket(deps: MarketDeps): Market {
  const manifest = goldManifest(deps.config)
  const levelPolicy = resolveLevelPolicy(GOLD_LEVEL_POLICY, deps.config.markets[GOLD_MARKET_REF])

  return {
    manifest,
    capabilities: {
      quote: {
        kind: 'quote',
        run: (request) => goldQuote(deps, request.instrument, request.signal),
      },
      overview: {
        kind: 'overview',
        run: (request) => runGoldOverview({ deps, manifest, request }),
      },
      bars: { kind: 'bars', run: (request) => goldBars(deps, request, manifest) },
      macroRisk: { kind: 'macroRisk', run: (request) => resolveMacroRisk(deps, request) },
      news: {
        kind: 'news',
        run: (request) =>
          deps.sources.resolve({
            kind: 'news',
            context: { market: GOLD_MARKET_REF, region: GOLD_REGION, limit: request.limit },
            signal: request.signal,
          }),
      },
      statistics: { kind: 'statistics', run: (request) => goldStatistics(deps, manifest, request) },
    },
    candidacy,
    detect: (options) => Promise.resolve(detect(options.ticker)),
    factors: async (options) => {
      const evidence = await loadGoldEvidence(deps, {
        instrument: options.instrument,
        asOf: options.asOf,
        fromDay: manifest.calendar.addTradingDays(options.asOf, -EVIDENCE_SESSIONS),
        now: options.now,
        signal: options.signal,
      })

      return scoreFactors(goldFactorInputs(evidence), FACTOR_POLICY)
    },
    levels: (options) =>
      Promise.resolve(buildLevels({ ...options, policy: levelPolicy, tickSize: WORLD_TICK })),
    ...trailOf(GOLD_LEVEL_POLICY),
  }
}

function goldQuote(
  deps: MarketDeps,
  instrument: InstrumentRef,
  signal: AbortSignal
): Promise<SourceResult<Quote>> {
  return deps.sources.resolve({ kind: 'quote', context: instrumentContext(instrument), signal })
}

// The manifest is where this market declares itself, including the timezone every `asOf` and
// cooldown computation resolves against. Config supplies overrides and the market supplies its own
// default; neither side enumerates the other.
function goldManifest(config: TradingConfig): MarketManifest {
  const defaultCalendar = WORLD_GOLD_CALENDAR

  return {
    id: GOLD_MARKET_REF,
    region: GOLD_REGION,
    assetClass: 'gold',
    segment: portfolioSegment('gold'),
    segmentCategory: 'gold',
    seedsDefaultTarget: false,
    currency: currencyCode('USD'),
    icon: '🥇',
    quoteUnit: quoteUnit('currency-per-troy-ounce'),
    defaultCalendar,
    calendar: createTradingCalendar(defaultCalendar, config.markets[GOLD_MARKET_REF]),
    // The only market trading the global region.
    ownsRegion: true,
    detection: 'stored',
    settlementSessions: 0,
    evidenceSessions: EVIDENCE_SESSIONS,
    horizon: 'long',
    boardLot: GOLD_BOARD_LOT,
    tickSize: WORLD_TICK,
    strategyVersion: strategyVersionOf(GOLD_STRATEGY_VERSION, config.markets[GOLD_MARKET_REF]),
    calculationVersions: [
      { name: 'factor-scoring', version: FACTOR_SCORING_VERSION },
      { name: 'levels', version: LEVEL_FORMULA_VERSION },
      { name: 'macro', version: MACRO_FORMULA_VERSION },
    ],
    factorIds: GOLD_FACTOR_IDS,
    playbook: { analysis: ['gold-analysis', 'macro-liquidity-analysis'] },
    minimumRiskReward: GOLD_MINIMUM_RISK_REWARD,
  }
}

// Pure and synchronous: gold has a fixed, tiny universe, so `impossible` is exact and no gold
// detector ever runs for an equity ticker.
function candidacy(candidate: Ticker): TickerCandidacy {
  return GOLD_ALIASES.has(candidate) ? 'possible' : 'impossible'
}

// An alias names the metal, not a distinct instrument, so all three resolve to one ref.
function detect(candidate: Ticker): MarketDetection {
  return GOLD_ALIASES.has(candidate)
    ? { kind: 'match', instrument: WORLD_GOLD_REF }
    : { kind: 'no-match' }
}

async function goldStatistics(
  deps: MarketDeps,
  manifest: MarketManifest,
  request: InstrumentRequest
): Promise<SourceResult<InstrumentStatistics>> {
  const bars = await goldBars(deps, { ...request, sessions: STATS_SESSIONS }, manifest)

  if (bars.kind === 'unavailable') {
    return bars
  }

  const statistics = statisticsFromCandles(bars.value, {
    instrument: request.instrument,
    asOf: request.asOf,
    liquiditySessions: GOLD_LIQUIDITY_SESSIONS,
    volatilitySessions: GOLD_VOLATILITY_SESSIONS,
  })

  return statistics === null
    ? unavailable('unsupported', [])
    : available(statistics, bars.provenance, bars.caveats)
}

function instrumentContext(instrument: InstrumentRef): SourceContext {
  return { market: GOLD_MARKET_REF, instrument }
}

/** The settled series, as every other market reads it: COMEX trades through the operator's day,
 *  and a forming bar's partial range shrank the ATR a stop is priced from. Sessions only: a token
 *  prints quiet weekend bars the metal never trades, and counted as sessions they pulled its ATR,
 *  and so its stop, a quarter inside the session distance the policy was measured on. */
function goldBars(
  deps: MarketDeps,
  request: BarsRequest,
  manifest: MarketManifest
): Promise<SourceResult<readonly Candle[]>> {
  const { calendar } = manifest

  return settledBars(deps, request, {
    calendar,
    defaultSessions: EVIDENCE_SESSIONS,
    fetch: async (window) => {
      const bars = await deps.sources.resolve({
        kind: 'bars',
        context: {
          market: GOLD_MARKET_REF,
          instrument: request.instrument,
          fromDay: window.fromDay,
          toDay: window.toDay,
          limit: window.sessions,
        },
        signal: request.signal,
      })

      return bars.kind === 'available'
        ? { ...bars, value: bars.value.filter((candle) => calendar.isTradingDay(candle.at)) }
        : bars
    },
  })
}
