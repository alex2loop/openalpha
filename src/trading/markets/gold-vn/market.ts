import type { TradingConfig } from '@/trading/kernel/config'
import type { FactorRequest, FactorScore, VnGoldFactorId } from '@/trading/kernel/factor'
import type { Ticker, VnGoldForm } from '@/trading/kernel/instrument'
import type { InstrumentRequest } from '@/trading/kernel/market/market-capability'
import type { GoldBoard, GoldBoardRow, Quote } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { FactorInput } from '@/trading/markets/factor-scoring'
import type { BoardCache, BoardSnapshot } from '@/trading/markets/gold-vn/board'
import type {
  Market,
  MarketDetection,
  MarketManifest,
  TickerCandidacy,
  TradingCalendar,
} from '@/trading/markets/types'
import { sourcedCaveat } from '@/trading/kernel/caveat'
import { VN_GOLD_FACTOR_IDS } from '@/trading/kernel/factor'
import { currencyCode, portfolioSegment, quoteUnit, region } from '@/trading/kernel/instrument'
import { MACRO_FORMULA_VERSION } from '@/trading/kernel/market/macro-series'
import { available, provenanceOf, unavailable } from '@/trading/kernel/source/source-result'
import { createTradingCalendar } from '@/trading/markets/calendar'
import { optionalRaw } from '@/trading/markets/evidence'
import { FACTOR_SCORING_VERSION, scoreFactors } from '@/trading/markets/factor-scoring'
import {
  EVIDENCE_SESSIONS,
  GOLD_STRATEGY_VERSION,
  goldFactorInputs,
  loadGoldEvidence,
  WORLD_GOLD_REF,
} from '@/trading/markets/gold/api'
import {
  boardCache,
  isBoardStale,
  readBoard,
  selectFromBoard,
  sourceIds,
  WORLD_CALENDAR,
  worldBars,
} from '@/trading/markets/gold-vn/board'
import { vnGoldLevels } from '@/trading/markets/gold-vn/levels'
import { runVnGoldOverview } from '@/trading/markets/gold-vn/overview'
import {
  GOLD_VN_FORM_TICKERS,
  GOLD_VN_LEVEL_POLICY,
  GOLD_VN_MARKET_REF,
  GOLD_VN_MINIMUM_RISK_REWARD,
  GOLD_VN_TICKERS,
  PREFERRED_FORMS,
  VN_GOLD_BOARD_LOT,
  VN_GOLD_CALENDAR,
  VN_GOLD_FACTOR_POLICY,
  VN_GOLD_TICK,
} from '@/trading/markets/gold-vn/policy'
import { rankPremium } from '@/trading/markets/gold-vn/premium'
import { refreshPremium } from '@/trading/markets/gold-vn/refresh'
import { resolveLevelPolicy, strategyVersionOf } from '@/trading/markets/level-settings'
import { LEVEL_FORMULA_VERSION } from '@/trading/markets/levels'
import { resolveMacroRisk } from '@/trading/markets/macro'
import { spreadPct } from '@/trading/markets/overview'

/** `percentileRank` reports 0-100; factor readings live on [0, 1]. */
const PERCENTILE_MAX = 100

const VN_REGION = region('vn')

export function createVnGoldMarket(deps: MarketDeps): Market {
  const manifest = goldVnManifest(deps.config)
  const levelPolicy = resolveLevelPolicy(
    GOLD_VN_LEVEL_POLICY,
    deps.config.markets[GOLD_VN_MARKET_REF]
  )
  const board = boardCache(deps, manifest)

  return {
    manifest,
    capabilities: {
      quote: {
        kind: 'quote',
        run: (request) => boardQuote(deps, manifest.calendar, request),
      },
      // Every form the board publishes, because "how is VN gold" is a question about the board and
      // no single form answers it; `quote` serves one form per call.
      overview: {
        kind: 'overview',
        run: async (request) =>
          runVnGoldOverview({
            snapshot: await board.get(request),
            manifest,
            deps,
            asOf: request.asOf,
            signal: request.signal,
          }),
      },
      // World bars in USD/oz: this market has no candle series of its own, and these carry the
      // volatility its levels convert into percentage risk distances. `referenceBarsOnly` on the
      // manifest is what stops a close, a change % or an outcome being read off them.
      bars: { kind: 'bars', run: (request) => worldBars(deps, request) },
      news: {
        kind: 'news',
        run: (request) =>
          deps.sources.resolve({
            kind: 'news',
            context: { market: GOLD_VN_MARKET_REF, region: VN_REGION, limit: request.limit },
            signal: request.signal,
          }),
      },
      macroRisk: { kind: 'macroRisk', run: (request) => resolveMacroRisk(deps, request) },
      refresh: {
        kind: 'refresh',
        run: (request) => refreshPremium({ deps, calendar: manifest.calendar, manifest }, request),
      },
    },
    candidacy,
    detect: (options) => Promise.resolve(detect(options.ticker)),
    factors: (options) => vnGoldFactors({ deps, manifest, board }, options),
    levels: (options) => Promise.resolve(vnGoldLevels(levelPolicy, options)),
  }
}

function goldVnManifest(config: TradingConfig): MarketManifest {
  const defaultCalendar = VN_GOLD_CALENDAR

  return {
    id: GOLD_VN_MARKET_REF,
    region: VN_REGION,
    assetClass: 'gold',
    segment: portfolioSegment('gold-vn'),
    segmentCategory: 'gold',
    seedsDefaultTarget: false,
    currency: currencyCode('VND'),
    icon: '🏦',
    quoteUnit: quoteUnit('currency-per-luong'),
    defaultCalendar,
    calendar: createTradingCalendar(defaultCalendar, config.markets[GOLD_VN_MARKET_REF]?.holidays),
    // Vietnam's trading day is the equity session's; the gold shop counter keeps its own hours.
    ownsRegion: false,
    detection: 'stored',
    settlementSessions: 0,
    evidenceSessions: EVIDENCE_SESSIONS,
    horizon: 'long',
    // The bars capability serves world gold in USD per troy ounce: a volatility reference, not this
    // market's own history. Only the levels path may read it.
    referenceBarsOnly: true,
    boardLot: VN_GOLD_BOARD_LOT,
    tickSize: VN_GOLD_TICK,
    strategyVersion: strategyVersionOf(GOLD_STRATEGY_VERSION, config.markets[GOLD_VN_MARKET_REF]),
    calculationVersions: [
      { name: 'factor-scoring', version: FACTOR_SCORING_VERSION },
      { name: 'levels', version: LEVEL_FORMULA_VERSION },
      { name: 'macro', version: MACRO_FORMULA_VERSION },
      { name: 'vn-gold-premium', version: GOLD_STRATEGY_VERSION },
    ],
    factorIds: VN_GOLD_FACTOR_IDS,
    // The premium is the position here, so the same analysis skill carries both legs; a dealer
    // board has no order rules of its own for a trader to read.
    playbook: { analysis: ['gold-analysis', 'macro-liquidity-analysis'] },
    minimumRiskReward: GOLD_VN_MINIMUM_RISK_REWARD,
  }
}

function candidacy(candidate: Ticker): TickerCandidacy {
  return GOLD_VN_TICKERS.has(candidate) ? 'possible' : 'impossible'
}

function detect(candidate: Ticker): MarketDetection {
  return GOLD_VN_TICKERS.has(candidate)
    ? { kind: 'match', instrument: { market: GOLD_VN_MARKET_REF, ticker: candidate } }
    : { kind: 'no-match' }
}

/** A quote reads the board and nothing else: world bars and FX gate the premium *factor*, and
 *  routing the price through that snapshot would leave a Sunday board unquotable because COMEX
 *  closed Friday — VN counters quote seven days a week. The board age check stays. */
async function boardQuote(
  deps: MarketDeps,
  calendar: TradingCalendar,
  request: InstrumentRequest
): Promise<SourceResult<Quote>> {
  const board = await readBoard(deps, request.signal)

  if (board.kind === 'unavailable') {
    return board
  }

  if (isBoardStale(calendar, board.value, request.now)) {
    return unavailable('stale', sourceIds(board), [
      ...board.caveats,
      sourcedCaveat('source.stale-cache', sourceIds(board), { sourceKind: 'goldBoard' }),
    ])
  }

  const row = quoteRow(board.value, GOLD_VN_FORM_TICKERS.get(request.instrument.ticker))

  if (row === undefined) {
    return unavailable('unsupported', sourceIds(board), [
      ...board.caveats,
      sourcedCaveat('source.symbol-not-found', sourceIds(board), {
        sourceKind: 'goldBoard',
        ticker: request.instrument.ticker,
      }),
    ])
  }

  const spread = spreadPct(row.buyPricePerLuong, row.sellPricePerLuong)

  return available(
    {
      instrument: request.instrument,
      price: row.sellPricePerLuong,
      observedAt: board.value.observedAt,
      board: {
        buyPrice: row.buyPricePerLuong,
        sellPrice: row.sellPricePerLuong,
        ...(spread === undefined ? {} : { spreadPct: spread }),
      },
    },
    board.provenance,
    board.caveats
  )
}

/** A named form asks for that row; a bare alias takes the policy-preferred form present. Premium
 *  displacement is a scoring concern — it needs world operands a quote never reads. */
function quoteRow(board: GoldBoard, form: VnGoldForm | undefined): GoldBoardRow | undefined {
  if (form !== undefined) {
    return board.rows.find((row) => row.form === form)
  }

  for (const preferred of PREFERRED_FORMS) {
    const row = board.rows.find((candidate) => candidate.form === preferred)

    if (row !== undefined) {
      return row
    }
  }

  return undefined
}

interface FactorDeps {
  readonly deps: MarketDeps
  readonly manifest: MarketManifest
  readonly board: BoardCache
}

async function vnGoldFactors(factorDeps: FactorDeps, options: FactorRequest): Promise<FactorScore> {
  const { deps, board } = factorDeps
  const [evidence, snapshot] = await Promise.all([
    loadGoldEvidence(deps, {
      instrument: WORLD_GOLD_REF,
      asOf: options.asOf,
      fromDay: WORLD_CALENDAR.addTradingDays(options.asOf, -EVIDENCE_SESSIONS),
      now: options.now,
      signal: options.signal,
    }),
    board.get(options),
  ])
  // The premium factor scores the market, not a named form, so policy picks.
  const selected = selectFromBoard(snapshot)
  const reading = await premiumReading(factorDeps, options, snapshot)
  const premium: FactorInput<VnGoldFactorId> = {
    id: 'local-premium',
    ...optionalRaw(reading),
    provenance: provenanceOf(selected),
    caveats: selected.caveats,
  }

  return scoreFactors([...goldFactorInputs(evidence), premium], VN_GOLD_FACTOR_POLICY)
}

/** Percentile of the board's own stored window, absent until that window fills. No fixed band
 *  stands in for it: a band encodes one premium regime, and the regime is what this measures. */
async function premiumReading(
  factorDeps: FactorDeps,
  options: FactorRequest,
  snapshot: SourceResult<BoardSnapshot>
): Promise<number | undefined> {
  if (snapshot.kind !== 'available') {
    return undefined
  }

  const { board, worldUsdPerOunce, usdVnd } = snapshot.value
  const ranking = await rankPremium(factorDeps.deps, {
    board,
    worldUsdPerOunce,
    usdVnd,
    calendar: factorDeps.manifest.calendar,
    toDay: options.asOf,
    signal: options.signal,
  })

  return ranking === undefined ? undefined : ranking.percentile / PERCENTILE_MAX
}
