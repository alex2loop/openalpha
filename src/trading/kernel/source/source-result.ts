import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import type {
  InstrumentKind,
  InstrumentRef,
  MarketRef,
  Region,
  Ticker,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { CashFlowToDate, FiledAccounts } from '@/trading/kernel/market/annual-accounts'
import type { CommodityHistory } from '@/trading/kernel/market/commodity'
import type { IndexContributions, IndexRatios } from '@/trading/kernel/market/index-reading'
import type {
  AnalystRecommendation,
  Candle,
  DailyTradeSides,
  EtfFlowSnapshot,
  FlowSnapshot,
  ForeignRoom,
  FundamentalSnapshot,
  FundingSnapshot,
  FxQuote,
  FxRatePoint,
  GoldBoard,
  GoldBoardPoint,
  IndexMembership,
  InstrumentRecord,
  MacroSnapshot,
  MarketCapRecord,
  MarketEvent,
  NewsItem,
  PositioningSnapshot,
  ProprietaryFlow,
  Quote,
  SentimentSnapshot,
  SessionQuote,
} from '@/trading/kernel/market/market-data'
import type { PolicyRateSnapshot } from '@/trading/kernel/market/policy-rates'
import type { StatReport } from '@/trading/kernel/market/stat-report'
import type { SupervisionSnapshot } from '@/trading/kernel/market/supervision'
import type { ValuationRatios } from '@/trading/kernel/market/valuation'
import type { SourceId } from '@/trading/kernel/source/source-id'

export const SOURCE_FRESHNESS = Object.freeze(['live', 'cached'] as const)
export type SourceFreshness = (typeof SOURCE_FRESHNESS)[number]

/** `empty` is every provider answering with nothing, which is settled; `failed` is at least one
 *  that could not answer, which is not. */
export const SOURCE_UNAVAILABLE_REASONS = Object.freeze([
  'unconfigured',
  'unsupported',
  'stale',
  'failed',
  'empty',
] as const)
type SourceUnavailableReason = (typeof SOURCE_UNAVAILABLE_REASONS)[number]

export interface SourceKindMap {
  readonly instruments: readonly InstrumentRecord[]
  readonly quote: Quote
  /** Oldest session first: every consumer reads the tail as the most recent one. */
  readonly bars: readonly Candle[]
  readonly fundamentals: readonly FundamentalSnapshot[]
  /** Every full-year and quarterly report the provider serves for one name. */
  readonly accounts: FiledAccounts
  /** Year-to-date cash flow of one quarter, from a provider that files it before the primary one.
   *  An empty list means the quarter is not published yet. */
  readonly cashFlowToDate: readonly CashFlowToDate[]
  readonly events: readonly MarketEvent[]
  readonly news: readonly NewsItem[]
  readonly macro: MacroSnapshot
  readonly policyRates: PolicyRateSnapshot
  readonly statReports: readonly StatReport[]
  readonly commodityPrices: CommodityHistory
  readonly valuationRatios: ValuationRatios
  /** What each name added to the index this session, from a day-less board that serves the session
   *  running or the last one finished. */
  readonly indexContributors: IndexContributions
  /** The newest day of an index's own ratios. */
  readonly indexValuation: IndexRatios
  readonly flows: readonly FlowSnapshot[]
  /** The leg alone, from a provider that publishes the proprietary desk ahead of the flows one. */
  readonly proprietaryFlows: readonly ProprietaryFlow[]
  readonly tradeSides: DailyTradeSides
  readonly foreignRoom: readonly ForeignRoom[]
  /** Only the names under exchange supervision, over the boards the read covered; a name absent
   *  from a covered board is unsupervised. */
  readonly supervision: SupervisionSnapshot
  readonly indexMembership: readonly IndexMembership[]
  readonly recommendations: readonly AnalystRecommendation[]
  readonly sentiment: SentimentSnapshot
  readonly funding: FundingSnapshot
  readonly marketCap: readonly MarketCapRecord[]
  readonly fx: FxQuote
  /** Oldest session first, like `bars`. Only the sessions the provider printed — a pair's history
   *  has holes where neither currency's market traded. */
  readonly fxHistory: readonly FxRatePoint[]
  readonly goldBoard: GoldBoard
  /** Oldest session first, like `bars`. Only the sessions the vendor published — a counter that did
   *  not revise leaves a hole rather than a repeated row. */
  readonly goldBoardHistory: readonly GoldBoardPoint[]
  readonly positioning: PositioningSnapshot
  readonly etfFlows: EtfFlowSnapshot
  readonly sessionQuotes: readonly SessionQuote[]
}

export type SourceKind = keyof SourceKindMap

const SOURCE_KIND_MEMBERSHIP = {
  instruments: true,
  quote: true,
  bars: true,
  fundamentals: true,
  accounts: true,
  cashFlowToDate: true,
  events: true,
  news: true,
  macro: true,
  policyRates: true,
  statReports: true,
  commodityPrices: true,
  valuationRatios: true,
  indexContributors: true,
  indexValuation: true,
  flows: true,
  proprietaryFlows: true,
  tradeSides: true,
  foreignRoom: true,
  supervision: true,
  indexMembership: true,
  recommendations: true,
  sentiment: true,
  funding: true,
  marketCap: true,
  fx: true,
  fxHistory: true,
  goldBoard: true,
  goldBoardHistory: true,
  positioning: true,
  etfFlows: true,
  sessionQuotes: true,
} as const satisfies Record<SourceKind, true>

export const SOURCE_KINDS = Object.freeze(
  // why-safe: the complete mapped membership object restricts every key to SourceKind.
  Object.keys(SOURCE_KIND_MEMBERSHIP) as readonly SourceKind[]
)

export interface SourceProvenance {
  readonly sourceId: SourceId
  readonly fetchedAt: number
  readonly freshness: SourceFreshness
  readonly observedAt?: number
}

interface SourceAvailable<T> {
  readonly kind: 'available'
  readonly value: T
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

export interface SourceUnavailable {
  readonly kind: 'unavailable'
  readonly reason: SourceUnavailableReason
  readonly attemptedSourceIds: readonly SourceId[]
  readonly caveats: readonly Caveat[]
}

export type SourceResult<T> = SourceAvailable<T> | SourceUnavailable

/** One market's headlines, with the market on the envelope rather than stamped onto every item -
 *  the shape `MarketDataOverview` already uses for a per-market read. Lives beside `SourceResult`
 *  rather than next to `NewsItem` in market-data.ts: that file feeds this one's `SourceKindMap`, so
 *  wrapping a `SourceResult` there would close an import cycle. */
export interface MarketNews {
  readonly market: MarketRef
  readonly result: SourceResult<readonly NewsItem[]>
}

/** The one feed group a caller names outright; every other news read is scoped by its market, or
 *  falls to the macro tape. Declared beside the field that carries it so the feature asking for it
 *  and the adapter routing on it cannot drift to different spellings — they would not fail, they
 *  would quietly serve the macro feed. */
export const ECONOMY_FEED_SCOPE = 'economy'

export interface SourceContext {
  /** Routing owns market scope; `covers` owns only whether the request shape is servable. Absent
   *  for kinds that genuinely have no owning market, such as FX pairs and macro series. */
  readonly market?: MarketRef
  readonly instrument?: InstrumentRef
  /** For providers that serve each instrument class from a different endpoint, or in a different
   *  unit. Absent means cash equity, which is what those providers default to. */
  readonly instrumentKind?: InstrumentKind
  /** A market-less symbol, for the kinds whose subject is not an instrument on an exchange: an
   *  FX pair or a commodity. Never a substitute for `instrument`. */
  readonly ticker?: Ticker
  /** The batch subject for a provider that answers many symbols in one request. Distinct from
   *  `ticker`, which names a market-less symbol such as an FX pair. */
  readonly tickers?: readonly Ticker[]
  readonly region?: Region
  /** Selects one feed group where market and region name none: the macro tape's economy feed
   *  is nobody's market. Read only by the adapter that owns the groups. */
  readonly feedScope?: string
  /** What the request is about, where the provider indexes no symbol: the caller's own spellings
   *  for the subject, most specific first. A text provider serves an instrument-scoped request
   *  only when these are present, so a market's whole tape can never stand in for one name. */
  readonly searchSubject?: readonly string[]
  /** The field of discourse the subject belongs to. Without it a name that is also an ordinary
   *  word is answered with whatever else that word appears in. */
  readonly searchTopic?: readonly string[]
  readonly fromDay?: TradingDay
  readonly toDay?: TradingDay
  readonly limit?: number
  /** Asks for the price as it stands now rather than the last settled close. Request shape, not
   *  routing: an adapter whose only series is already the current price ignores it. */
  readonly live?: boolean
}

export interface Source<K extends SourceKind> {
  readonly id: SourceId
  readonly kind: K
  covers(context: SourceContext): boolean
  fetch(context: SourceContext, signal: AbortSignal): Promise<SourceResult<SourceKindMap[K]>>
  summary(): SourceSummary
}

export type RegisteredSource = {
  [K in SourceKind]: Source<K>
}[SourceKind]

export interface SourceSummary {
  readonly id: SourceId
  readonly kind: SourceKind
  readonly lastSuccessAt?: number
  readonly lastFailureCode?: CaveatCode
  readonly breaker: 'closed' | 'open'
}

export function unavailable(
  reason: SourceUnavailableReason,
  attemptedSourceIds: readonly SourceId[],
  caveats: readonly Caveat[] = []
): SourceUnavailable {
  return { kind: 'unavailable', reason, attemptedSourceIds, caveats }
}

/** An outage, not an empty window or a feed the market lacks. */
export function isSourceFailed(result: SourceResult<unknown> | undefined): boolean {
  return result?.kind === 'unavailable' && result.reason === 'failed'
}

export function available<T>(
  value: T,
  provenance: readonly SourceProvenance[],
  caveats: readonly Caveat[] = []
): SourceAvailable<T> {
  return { kind: 'available', value, provenance, caveats }
}

/** The same envelope over a reshaped value: an unavailable result passes through untouched, so a
 *  caller never rebuilds provenance and caveats to change what sits inside them. */
export function mapSourceValue<T, U>(
  result: SourceResult<T>,
  map: (value: T) => U
): SourceResult<U> {
  return result.kind === 'unavailable' ? result : { ...result, value: map(result.value) }
}

/** Merging several source results repeats the same stamp once per target. First occurrence wins,
 *  so the order a caller merged its reads in survives. */
/** The stamps a result carries, or none — an unavailable result names what it attempted, which is
 *  a diagnostic rather than evidence, and must never be cited as the source of a value. */
export function provenanceOf<T>(result: SourceResult<T>): readonly SourceProvenance[] {
  return result.kind === 'available' ? result.provenance : []
}

export function dedupeProvenance(stamps: readonly SourceProvenance[]): readonly SourceProvenance[] {
  const seen = new Set<string>()

  return stamps.filter((stamp) => {
    const key = `${stamp.sourceId}|${stamp.fetchedAt}|${stamp.freshness}|${stamp.observedAt ?? ''}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}
