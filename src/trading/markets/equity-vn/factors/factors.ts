import type { Caveat } from '@/trading/kernel/caveat'
import type { FactorScore, VnEquityFactorId } from '@/trading/kernel/factor'
import type { FactorMetric, FactorMetricId } from '@/trading/kernel/factor-metric'
import type { InstrumentRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { AnnualAccounts, QuarterlyAccounts } from '@/trading/kernel/market/annual-accounts'
import type { SectorStrength } from '@/trading/kernel/market/market-capability'
import type {
  BarRecord,
  Candle,
  FlowSnapshot,
  FundamentalSnapshot,
  InstrumentRecord,
} from '@/trading/kernel/market/market-data'
import type { SupervisionLevel } from '@/trading/kernel/market/supervision'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { NameAccounts } from '@/trading/markets/equity-vn/accounts/board'
import type { SupervisionCoverage } from '@/trading/markets/equity-vn/evidence/supervision'
import type { IndexReviewProximity } from '@/trading/markets/equity-vn/index-review'
import type { FactorInput } from '@/trading/markets/factor-scoring'
import type { SectorMember } from '@/trading/markets/sector-strength'
import type { TradingCalendar } from '@/trading/markets/types'
import { ticker } from '@/trading/kernel/instrument'
import {
  accountsAverageProfit,
  accountsQualityExtras,
  readBoardAccounts,
} from '@/trading/markets/equity-vn/accounts/board'
import { withStaleCaveats } from '@/trading/markets/equity-vn/evidence/factor-staleness'
import { latestBarProvenance } from '@/trading/markets/equity-vn/evidence/provenance'
import { ETF_FACTOR_POLICY, VN_FACTOR_POLICY } from '@/trading/markets/equity-vn/factor-policy'
import {
  benchmarkBars,
  etfFactorInputs,
  etfTrackingErrors,
} from '@/trading/markets/equity-vn/factors/etf'
import {
  averageProfitMetrics,
  qualityMetrics,
  qualityPercentiles,
  rankedPeerCount,
  speculativeTurnoverPercentiles,
  valuationMetrics,
  valuePercentiles,
} from '@/trading/markets/equity-vn/factors/fundamental-ranks'
import { indexReviewProximity } from '@/trading/markets/equity-vn/index-review'
import {
  FLOW_DEVIATION_SESSIONS,
  HIGH_PROXIMITY_SESSIONS,
  LIQUIDITY_SESSIONS,
  SPECULATIVE_TURNOVER_SESSIONS,
  TREND_SESSIONS,
  TREND_SLOPE_SESSIONS,
  VN_INDEX_TICKER,
  VN_MARKET_REF,
  VN_MAX_EVIDENCE_LAG_SESSIONS,
  VN_SECTOR_POLICY,
} from '@/trading/markets/equity-vn/policy'
import { adjustedCloses, screenCandidate, toScreenInput } from '@/trading/markets/equity-vn/screen'
import {
  foreignFlowRatio,
  foreignNetFlow,
  netFlowValue,
  proprietaryFlowRatio,
  proprietaryNetFlow,
} from '@/trading/markets/equity-vn/tape/flows'
import { scoreFactors } from '@/trading/markets/factor-scoring'
import { sectorStrength } from '@/trading/markets/sector-strength'
import {
  trailingAverage,
  trailingHigh,
  trendWithSlope,
  yearHighProximity,
} from '@/trading/markets/timeseries'
import { averageTurnover, medianTurnover } from '@/trading/markets/turnover'

export interface NameEvidence {
  readonly record: InstrumentRecord
  readonly bars: readonly BarRecord[]
  readonly closes: readonly number[]
  readonly flows: readonly FlowSnapshot[]
  readonly fundamental: FundamentalSnapshot | null
  /** Absent means the exchange has declared nothing about this name, or nothing could be read. */
  readonly supervision?: SupervisionLevel
  /** What an ordinary session trades, in đồng. Absent where the window held no usable session. */
  readonly turnover?: number
  /** A year of average daily traded value, in đồng. Absent where the window held no usable session. */
  readonly annualTurnover?: number
  /** Clears every screen gate. Decides both who reaches the board and the population the ranked
   *  factors normalize over, so it is resolved once here rather than by each caller. */
  readonly screened: boolean
}

/** This name's bar for the session being reported, if it traded and the bar can be compared. A
 *  name with no bar for the session did not trade, and an unadjusted bar prices a split as a crash:
 *  either way it belongs in no session statistic, as absent rather than as an unchanged name. */
export function sessionBar(name: NameEvidence, session: TradingDay): BarRecord | undefined {
  const last = name.bars[name.bars.length - 1]

  return isTradedBar(last) && last.candle.at === session ? last : undefined
}

/** The population's own newest session. Every market-wide statistic is a fact about the names, and
 *  the index is two instruments on a different provider whose leg is written minutes later: dating
 *  the names' numbers to the index's day, or to a request's, gates every one of them out and the
 *  market reports no breadth at all rather than the breadth it holds. */
export function latestNameSession(names: readonly NameEvidence[]): TradingDay | undefined {
  let latest: TradingDay | undefined

  for (const name of names) {
    const at = name.bars[name.bars.length - 1]?.candle.at

    if (at !== undefined && (latest === undefined || at > latest)) {
      latest = at
    }
  }

  return latest
}

/** Everything a population-wide pass produces once per day: the per-name evidence, the percentile
 *  each cross-sectional factor needs, and the sector roll-up the board and the brief share. A rank
 *  factor is meaningless outside its population, so the ranking happens here — exactly once — and
 *  the per-name assembly below only reads it. */
export interface CrossSection {
  readonly asOf: TradingDay
  readonly freshFrom: TradingDay
  /** What the pass read that does not move with the day, kept so an earlier day can be cut from it. */
  readonly stable: StableInputs
  readonly names: readonly NameEvidence[]
  readonly byTicker: ReadonlyMap<Ticker, NameEvidence>
  readonly quality: ReadonlyMap<Ticker, number>
  readonly value: ReadonlyMap<Ticker, number>
  /** Each fetched name's annual-report readings on this board day. Absent means nothing could be
   *  read, never a weak report. */
  readonly accounts: ReadonlyMap<Ticker, NameAccounts>
  /** How many names the published ranks were measured against. */
  readonly rankedPeers: number
  readonly speculativeTurnover: ReadonlyMap<Ticker, number>
  /** Each fund's dispersion against the index it tracks. Not a rank: the fund factors score
   *  against absolute bounds, so the population supplies no scale. */
  readonly etfTrackingErrors: ReadonlyMap<Ticker, number>
  readonly sectors: readonly SectorStrength[]
  /** The index's own candles, dated: a fund/index pairing (tracking error) aligns by trading day
   *  rather than array position, and a reader dated to one session can tell a series that stops
   *  short of it from one that reaches it. */
  readonly indexBars: readonly Candle[]
  /** Each ETF benchmark index's bars, keyed by the index ticker. An index the store has no bars
   *  for is absent, never an empty series. */
  readonly benchmarks: ReadonlyMap<Ticker, readonly BarRecord[]>
  /** Which boards the supervision read reached. A surface turns it into caveats against the names
   *  it judged, because a board holding none of them was missed for nobody. */
  readonly supervisionCoverage: SupervisionCoverage
  /** What the population pass could not read, for the surfaces that must not present a partial
   *  board as a checked one. */
  readonly caveats: readonly Caveat[]
  /** Set on the eve and the session of an index rebalance: proprietary desks warehouse inventory
   *  for it, so their flow reads as positioning rather than direction. Dated by the session the
   *  evidence ends at rather than by the day the question is asked, or the same settled tape
   *  answers differently depending on when someone screens it. */
  readonly indexReview?: IndexReviewProximity
}

/** What a pass reads that does not move with the day it is built for. The pass keeps it, so an
 *  earlier day is cut from the pass without another read. */
export interface StableInputs {
  readonly universe: readonly InstrumentRecord[]
  readonly supervision: ReadonlyMap<Ticker, SupervisionLevel>
  readonly supervisionCoverage: SupervisionCoverage
  readonly caveats: readonly Caveat[]
  readonly calendar: TradingCalendar
  readonly annualAccounts: ReadonlyMap<Ticker, readonly AnnualAccounts[]>
  readonly quarterlyAccounts: ReadonlyMap<Ticker, readonly QuarterlyAccounts[]>
}

export interface NameReads {
  readonly record: InstrumentRecord
  readonly bars: readonly BarRecord[]
  readonly flows: readonly FlowSnapshot[]
  readonly fundamental: FundamentalSnapshot | null
}

/** Everything a pass reads that moves with the day, and the only thing `assembleCrossSection` takes
 *  of it. The store read and the cut of a later pass (`evidence/cross-section-cache.ts`) each fill
 *  `NameReads` and end in `evidenceOf` and `buildDayInputs`, so an input added to either shape is a
 *  type error in whichever does not supply it. */
interface DayInputs {
  readonly asOf: TradingDay
  readonly freshFrom: TradingDay
  readonly index: readonly Candle[]
  readonly benchmarks: ReadonlyMap<Ticker, readonly BarRecord[]>
  readonly names: readonly NameEvidence[]
}

export function assembleCrossSection(stable: StableInputs, day: DayInputs): CrossSection {
  const { names } = day
  const session = latestNameSession(names) ?? day.asOf
  const indexReview = indexReviewProximity(session, stable.calendar)

  return {
    asOf: day.asOf,
    freshFrom: day.freshFrom,
    stable,
    names,
    byTicker: new Map(names.map((name) => [name.record.instrument.ticker, name])),
    quality: qualityPercentiles(names),
    value: valuePercentiles(names),
    accounts: readBoardAccounts({
      universe: stable.universe,
      reports: stable.annualAccounts,
      quarters: stable.quarterlyAccounts,
      asOf: day.asOf,
    }),
    rankedPeers: rankedPeerCount(names),
    speculativeTurnover: speculativeTurnoverPercentiles(names),
    etfTrackingErrors: etfTrackingErrors(
      names.filter((name) => name.record.kind === 'etf'),
      day.benchmarks
    ),
    sectors: sectorStrength({
      members: names.map(toSectorMember),
      benchmark: day.index,
      session,
      policy: VN_SECTOR_POLICY,
    }),
    indexBars: day.index,
    benchmarks: day.benchmarks,
    supervisionCoverage: stable.supervisionCoverage,
    caveats: stable.caveats,
    ...(indexReview === undefined ? {} : { indexReview }),
  }
}

export function evidenceOf(reads: NameReads, stable: StableInputs, asOf: TradingDay): NameEvidence {
  const { record, bars, flows, fundamental } = reads
  const supervision = stable.supervision.get(record.instrument.ticker)
  const turnover = medianTurnover(bars, LIQUIDITY_SESSIONS)
  const annualTurnover = averageTurnover(bars, SPECULATIVE_TURNOVER_SESSIONS)
  const source = {
    record,
    bars,
    fundamental,
    closes: adjustedCloses(bars),
    ...(supervision === undefined ? {} : { supervision }),
  }

  return {
    ...source,
    flows,
    screened: screenCandidate(toScreenInput(source, asOf)).kind === 'accepted',
    ...(turnover === undefined ? {} : { turnover }),
    ...(annualTurnover === undefined ? {} : { annualTurnover }),
  }
}

export function buildDayInputs(
  calendar: TradingCalendar,
  asOf: TradingDay,
  series: Omit<DayInputs, 'asOf' | 'freshFrom'>
): DayInputs {
  return {
    ...series,
    asOf,
    freshFrom: calendar.addTradingDays(asOf, -VN_MAX_EVIDENCE_LAG_SESSIONS),
    benchmarks: new Map([...series.benchmarks].filter(([, bars]) => bars.length > 0)),
  }
}

export function tradeableNames(universe: readonly InstrumentRecord[]): readonly InstrumentRecord[] {
  return universe.filter((record) => record.kind === 'equity' || record.kind === 'etf')
}

/** The VN factor id wiring, not new math: every raw value below comes from a shared owner —
 *  `timeseries` for the trend, `flows` for both flow ratios, and the cross-section for the three
 *  ranked fields. */
function stockFactorInputs(
  evidence: NameEvidence,
  cross: CrossSection
): readonly FactorInput<VnEquityFactorId>[] {
  const key = evidence.record.instrument.ticker
  const provenance = latestBarProvenance(evidence)

  const quality = cross.quality.get(key)
  const extras = accountsQualityExtras(cross.accounts.get(key))
  const value = cross.value.get(key)
  const peers = cross.rankedPeers

  return [
    withMetrics(input('trend', trendScore(evidence.closes), provenance), levelMetrics(evidence)),
    withMetrics({ ...input('quality', quality, provenance), caveats: extras.caveats }, [
      ...qualityMetrics(evidence, quality, peers),
      ...extras.metrics,
    ]),
    withMetrics(input('value', value, provenance), [
      ...valuationMetrics(evidence, value, peers),
      ...averageProfitMetrics(evidence, accountsAverageProfit(cross.accounts.get(key))),
    ]),
    input('speculative-turnover', cross.speculativeTurnover.get(key), provenance),
    withMetrics(
      input('foreign-flow', foreignFlowRatio(evidence.flows, evidence.bars), provenance),
      netFlowMetrics('foreign-net-flow', foreignNetFlow(evidence.flows, evidence.bars))
    ),
    proprietaryFlowInput(evidence, cross, provenance),
    withMetrics(
      input(
        'high-proximity',
        yearHighProximity(evidence.closes, HIGH_PROXIMITY_SESSIONS),
        provenance
      ),
      priceMetric(
        'year-high',
        trailingHigh(evidence.closes, HIGH_PROXIMITY_SESSIONS),
        HIGH_PROXIMITY_SESSIONS
      )
    ),
  ]
}

/** A rebalance moves the desks' book in the names the baskets hold, so only a constituent's flow
 *  reads as positioning. Abstaining for the whole board spent the factor on names no index carries
 *  and, because the composite renormalizes over what fired, moved every other name's score with it. */
function proprietaryFlowInput(
  evidence: NameEvidence,
  cross: CrossSection,
  provenance: readonly SourceProvenance[]
): FactorInput<VnEquityFactorId> {
  if (cross.indexReview !== undefined && evidence.record.indexTier !== undefined) {
    return { ...input('proprietary-flow', undefined, provenance), inapplicable: true }
  }

  return withMetrics(
    input('proprietary-flow', proprietaryFlowRatio(evidence.flows, evidence.bars), provenance),
    netFlowMetrics('proprietary-net-flow', proprietaryNetFlow(evidence.flows, evidence.bars))
  )
}

/** The moving average the trend statistic is measured against — the level a "wait for the trend to
 *  turn" condition is actually written in terms of. */
function levelMetrics(evidence: NameEvidence): readonly FactorMetric[] {
  return priceMetric(
    'trend-average',
    trailingAverage(evidence.closes, TREND_SESSIONS),
    TREND_SESSIONS
  )
}

function netFlowMetrics(
  id: 'foreign-net-flow' | 'proprietary-net-flow',
  net: ReturnType<typeof foreignNetFlow>
): readonly FactorMetric[] {
  return net === undefined ? [] : [{ id, ...net }]
}

function priceMetric(
  id: FactorMetricId,
  value: number | undefined,
  sessions: number
): readonly FactorMetric[] {
  return value === undefined || value <= 0 ? [] : [{ id, value, sessions }]
}

/** One score owner for suggestion factors, screen ranking, and watchlist leaders. */
export function scoreNameFactors(evidence: NameEvidence, cross: CrossSection): FactorScore {
  if (evidence.record.kind !== 'etf') {
    const inputs = stockFactorInputs(evidence, cross)

    return scoreFactors(withStaleCaveats(inputs, evidence, cross.freshFrom), VN_FACTOR_POLICY)
  }

  const key = evidence.record.instrument.ticker
  const benchmark = benchmarkBars(key, cross.benchmarks)
  const benchmarkAt = benchmark?.at(-1)?.candle.at
  const trackingError = cross.etfTrackingErrors.get(key)
  // Both factors read the index, so they cite its series rather than the fund's own tape.
  const inputs = etfFactorInputs({
    ...(benchmark === undefined
      ? {}
      : { benchmarkCloses: benchmark.map((bar) => bar.candle.close) }),
    ...(trackingError === undefined ? {} : { trackingError }),
    provenance: latestBarProvenance(benchmark === undefined ? evidence : { bars: benchmark }),
  })
  const dated = benchmarkAt === undefined ? evidence : { ...evidence, benchmarkAt }

  return scoreFactors(withStaleCaveats(inputs, dated, cross.freshFrom), ETF_FACTOR_POLICY)
}

/** Moving-average distance and slope, averaged: price above a rising average is the only
 *  configuration both components agree on. */
function trendScore(closes: readonly number[]): number | undefined {
  return trendWithSlope(closes, TREND_SESSIONS, TREND_SLOPE_SESSIONS)
}

export function toSectorMember(evidence: NameEvidence): SectorMember {
  const newest = evidence.bars[evidence.bars.length - 1]
  const marketCap = evidence.fundamental?.marketCap

  return {
    ticker: evidence.record.instrument.ticker,
    ...(evidence.record.sector === undefined ? {} : { sector: evidence.record.sector }),
    closes: evidence.closes,
    foreignNetBase: netFlowValue(evidence.flows, FLOW_DEVIATION_SESSIONS),
    ...(marketCap === undefined ? {} : { marketCap }),
    ...(isTradedBar(newest) ? { at: newest.candle.at } : {}),
  }
}

/** The index instrument, used as the sector benchmark and the ETF trend input. */
export const VN_INDEX_INSTRUMENT: InstrumentRef = Object.freeze({
  market: VN_MARKET_REF,
  ticker: ticker(VN_INDEX_TICKER),
})

function input(
  id: VnEquityFactorId,
  raw: number | undefined,
  provenance: readonly SourceProvenance[]
): FactorInput<VnEquityFactorId> {
  return { id, ...(raw === undefined ? {} : { raw }), provenance, caveats: [] }
}

function withMetrics(
  entry: FactorInput<VnEquityFactorId>,
  metrics: readonly FactorMetric[]
): FactorInput<VnEquityFactorId> {
  return metrics.length === 0 ? entry : { ...entry, metrics }
}

/** Whether a bar can carry a session statistic. Zero volume carries the previous close forward, so
 *  counting it reads as a name that held its price. An unadjusted bar prices a split as a crash,
 *  and `closes` has already dropped it, so its day would date a move the series does not hold. */
function isTradedBar(bar: BarRecord | undefined): bar is BarRecord {
  return bar !== undefined && bar.candle.adjustment === 'adjusted' && bar.candle.volume > 0
}
