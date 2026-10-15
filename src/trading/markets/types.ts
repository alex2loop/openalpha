import type { CalculationVersion } from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { CalendarPolicy } from '@/trading/kernel/config'
import type {
  FactorId,
  FactorRequest,
  FactorScore,
  LevelResult,
  MarketLevelRequest,
} from '@/trading/kernel/factor'
import type {
  AssetClass,
  BoardLotPolicy,
  CurrencyCode,
  InstrumentKind,
  InstrumentRef,
  InstrumentSearch,
  MarketRef,
  PortfolioSegment,
  PositionCategory,
  PriceDisplay,
  QuoteUnit,
  Region,
  Ticker,
  TickSizePolicy,
  TradingDay,
  TradingSessionState,
} from '@/trading/kernel/instrument'
import type { AccountsHistory } from '@/trading/kernel/market/annual-accounts'
import type {
  BarsRequest,
  EventsRequest,
  FlowsRequest,
  FuturesBasis,
  InstrumentRequest,
  InstrumentStatistics,
  MarketBriefRequest,
  MarketRequest,
  NewsRequest,
  QuoteRequest,
  RegionRequest,
  ScreenRequest,
  ScreenResult,
  SectorStrengthResult,
} from '@/trading/kernel/market/market-capability'
import type {
  AnalystRecommendation,
  Candle,
  DailyTradeSides,
  FlowSnapshot,
  FundingSnapshot,
  MarketEvent,
  NewsItem,
  Quote,
  SentimentSnapshot,
} from '@/trading/kernel/market/market-data'
import type { MacroRiskView } from '@/trading/kernel/market/market-macro'
import type { MarketDataOverview } from '@/trading/kernel/market/market-overview'
import type {
  MarketRefreshAttempt,
  RefreshDataKind,
  RefreshKindResult,
} from '@/trading/kernel/market/refresh'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { InvestmentHorizon } from '@/trading/kernel/operator/profile'
import type { MarketPlaybook } from '@/trading/kernel/skill'
import type {
  Source,
  SourceContext,
  SourceKind,
  SourceKindMap,
  SourceResult,
  SourceSummary,
} from '@/trading/kernel/source/source-result'
import type { StageReporter } from '@/trading/kernel/surface/tool-progress'
import type { AdmissionPolicy } from '@/trading/markets/admission'
import type { MarketPriceLimit } from '@/trading/markets/price-limit'

export interface TradingCalendar {
  /** The effective zone, after any operator calendar override — the one a schedule's local time is
   *  read in. `defaultCalendar` still names the built-in policy and would ignore the override. */
  readonly timezone: string
  /** A market that never closes: every instant is mid-session, so it has no pre-open or post-close
   *  state and no end-of-day refresh to schedule. Its bars are still settled days only — the day in
   *  progress is never evidence. Effective after any override, like `timezone`. */
  readonly continuous: boolean
  /** The newest closure the exchange's published table reaches. Absent where the market observes
   *  none beyond its weekend. */
  readonly lastHoliday?: TradingDay
  dayAt(epochMs: number): TradingDay
  isTradingDay(day: TradingDay): boolean
  addTradingDays(day: TradingDay, count: number): TradingDay
  sessionOpenAt(day: TradingDay): number
  /** The instant this day's session ends — where a settled daily bar's close was observed. */
  sessionCloseAt(day: TradingDay): number
  /** The instant this day's figures stop changing: the close plus the lag the board needs to
   *  publish its closing auction. What separates a final tape from one read at the bell. */
  tapeFinalAt(day: TradingDay): number
  sessionState(epochMs: number): TradingSessionState
}

export interface MarketManifest {
  readonly id: MarketRef
  readonly region: Region
  readonly assetClass: AssetClass
  readonly segment: PortfolioSegment
  readonly segmentCategory: PositionCategory
  /** Whether the seeded default profile gives this segment a share of its category. A fresh book
   *  starts with crypto and the home region's own markets only; every other market is analyzed and
   *  quoted like any other but starts at zero, and its category's share goes to the seeded sleeves.
   *  Absent means seeded. An operator who wants the sleeve opens it with
   *  `/profile enable <sleeve>`, which seeds it by `seedWeight` like any other.
   *  `'home'` seeds a national market only for an operator whose home region it trades in. */
  readonly seedsDefaultTarget?: boolean | 'home'
  /** This sleeve's share of its category's seeded allocation, relative to its siblings. Absent is an
   *  even split, which is right where they are the same kind of claim; declared below one where they
   *  are not. Seeds only - every ceiling follows from the target, and the operator's own override. */
  readonly seedWeight?: number
  readonly currency: CurrencyCode
  /** Emoji shown in a brief block's header. One per market, terminal-safe. */
  readonly icon: string
  readonly quoteUnit: QuoteUnit
  readonly calendar: TradingCalendar
  readonly defaultCalendar: CalendarPolicy
  /** Whether this market speaks for its whole region: its calendar defines the region's trading
   *  day, and its macro capability publishes the region's composite. Regions hold more than one
   *  market (Vietnam trades both domestic gold and equities), so leaving either to registration
   *  order silently hands the region to whichever registered first. Exactly one market per region
   *  claims it, checked at boot. */
  readonly ownsRegion: boolean
  /** Where `detect` reads from. `stored` answers out of this process's own state at no cost;
   *  `fetched` reaches a provider. Resolution asks the stored markets first and stops on a single
   *  match, so an equity ticker never spends a coin lookup to be told it is not a coin. */
  readonly detection: 'stored' | 'fetched'
  readonly settlementSessions: number
  /** How many sessions of history this market's factor pipeline reads. Retention derives from the
   *  largest of these, so a market cannot ask for evidence the sweep has already deleted. */
  readonly evidenceSessions: number
  /** How long this market's edge lasts, which is what the stop distance is sized for. Crypto
   *  momentum decays inside a month; equity momentum runs for quarters. Seeds the operator's
   *  per-sleeve horizon and is overridden there, never here. */
  readonly horizon: InvestmentHorizon
  readonly boardLot: BoardLotPolicy
  readonly tickSize: TickSizePolicy
  /** How this market's venue quotes a price on the board. VN boards print 27.55 for 27,550 VND; a
   *  suggestion that says 27,550 makes the reader cross-check against a number their broker app
   *  never shows. Absent means prices render as plain amounts. */
  readonly priceDisplay?: PriceDisplay
  readonly strategyVersion: string
  readonly calculationVersions: readonly CalculationVersion[]
  readonly factorIds: readonly FactorId[]
  /** The playbooks this market hands its debate roles. Declared here because what a role has to
   *  know before arguing or placing an order is the market's own knowledge — its band rules, its
   *  premium, its funding — and a role cannot be asked to pick them out of a catalogue by name. */
  readonly playbook: MarketPlaybook
  /** Set where a breakout's relative volume was measured to grade it rather than time it, so a
   *  trader's wait on volume alone enters instead of holding the row. */
  readonly volumeGradesBreakout?: boolean
  /** The instrument kinds this market's universe screen may be narrowed to — the only declaration
   *  of which kinds are screenable anywhere, so adding a market that screens by a new kind edits no
   *  central list. A single-kind universe declares that one kind, where narrowing is the identity; a
   *  market that declares nothing refuses the argument rather than answering with an empty board
   *  that reads as "nothing passed". */
  readonly screenableKinds?: readonly InstrumentKind[]
  /** The risk-reward a stored suggestion's levels must still pay at the current price before that
   *  suggestion stops describing a tradeable setup. A market that trades while nobody reads it moves
   *  past its own levels overnight, so the cooldown alone would serve numbers priced for a market
   *  that no longer exists. Read against a live quote, which is why it is the market's own call: one
   *  that omits it keeps its stored answer for the whole cooldown and pays for no quote. */
  readonly minimumRiskReward?: number
  /** Set when this market's `bars` capability answers with a volatility REFERENCE series rather
   *  than this instrument's own price history - a different instrument, in a different unit, from
   *  which only relative moves carry over. gold-vn is the case: it quotes VND per lượng and has no
   *  candle series of its own, so it serves world gold in USD per troy ounce. A close, a change
   *  percentage, a turnover, a pullback and an outcome resolution must abstain rather than compare
   *  across the two; the levels path converts ATR into percentage distances and is unaffected. */
  readonly referenceBarsOnly?: boolean
  /** The series a suggestion's outcome is compared against. The market names its own benchmark
   *  because only it knows which index its names actually track; a market that has none simply
   *  reports outcomes without a comparison rather than borrowing another market's index. */
  readonly benchmark?: InstrumentRef
  readonly admission?: AdmissionPolicy
}

interface MarketCapabilityMap {
  readonly quote: { readonly request: QuoteRequest; readonly result: SourceResult<Quote> }
  readonly bars: {
    readonly request: BarsRequest
    readonly result: SourceResult<readonly Candle[]>
  }
  readonly overview: { readonly request: MarketRequest; readonly result: MarketDataOverview }
  readonly events: {
    readonly request: EventsRequest
    readonly result: SourceResult<readonly MarketEvent[]>
  }
  readonly news: {
    readonly request: NewsRequest
    readonly result: SourceResult<readonly NewsItem[]>
  }
  readonly screen: { readonly request: ScreenRequest; readonly result: ScreenResult }
  readonly sectors: { readonly request: MarketRequest; readonly result: SectorStrengthResult }
  readonly sentiment: {
    readonly request: MarketRequest
    readonly result: SourceResult<SentimentSnapshot>
  }
  readonly funding: {
    readonly request: InstrumentRequest
    readonly result: SourceResult<FundingSnapshot>
  }
  readonly recommendations: {
    readonly request: InstrumentRequest
    readonly result: SourceResult<readonly AnalystRecommendation[]>
  }
  readonly accounts: {
    readonly request: InstrumentRequest
    readonly result: SourceResult<AccountsHistory>
  }
  readonly flows: {
    readonly request: FlowsRequest
    readonly result: SourceResult<readonly FlowSnapshot[]>
  }
  readonly tradeSides: {
    readonly request: InstrumentRequest
    readonly result: SourceResult<DailyTradeSides>
  }
  readonly statistics: {
    readonly request: InstrumentRequest
    readonly result: SourceResult<InstrumentStatistics>
  }
  readonly macroRisk: {
    readonly request: RegionRequest
    readonly result: SourceResult<MacroRiskView>
  }
  readonly basis: { readonly request: MarketRequest; readonly result: SourceResult<FuturesBasis> }
  readonly brief: {
    readonly request: MarketBriefRequest
    readonly result: readonly BriefSectionResult[]
  }
  /** How this market replaces its own tradeable universe. A market that has no universe to
   *  refresh simply does not publish it, so the refresh operation iterates capabilities rather
   *  than a per-market switch. */
  readonly refresh: {
    readonly request: MarketDataRefreshRequest
    readonly result: readonly RefreshKindResult[]
  }
  /** Which stored kinds a refresh would actually refetch. Cadences differ per kind — a listing set
   *  is replaced weekly, fundamentals every few sessions — and only the market knows them. */
  readonly staleKinds: {
    readonly request: StaleKindsRequest
    readonly result: readonly RefreshDataKind[]
  }
}

/** The attempts the caller already read, so answering costs no second query. */
export interface StaleKindsRequest {
  readonly attempts: readonly MarketRefreshAttempt[]
  readonly now: number
  readonly signal: AbortSignal
}

/** A market reports what it actually replaced, per kind. A bare status cannot fill
 *  `RefreshMarketDataResult`, whose rows carry the record count an operator reads. The coordinator
 *  threads its own clock so a market never reads the global operation config to decide whether a
 *  stored attempt already covers the session. */
export interface MarketDataRefreshRequest {
  readonly limit: number
  readonly asOf: TradingDay
  readonly now: number
  /** Fetch even when a stored attempt already covers the settled session. */
  readonly forced: boolean
  readonly signal: AbortSignal
  /** Present when a surface is waiting; a market reports the kind it is fetching through it. */
  readonly progress?: StageReporter
}

export type MarketCapability<K extends keyof MarketCapabilityMap = keyof MarketCapabilityMap> = {
  readonly [P in K]: {
    readonly kind: P
    run(request: MarketCapabilityMap[P]['request']): Promise<MarketCapabilityMap[P]['result']>
  }
}[K]

export type MarketCapabilities = Readonly<
  Partial<{ [K in keyof MarketCapabilityMap]: Extract<MarketCapability, { readonly kind: K }> }>
>

export type TickerCandidacy = 'impossible' | 'possible'

export interface DetectInstrumentOptions {
  readonly ticker: Ticker
  readonly signal: AbortSignal
}

/** A no-match may carry caveats because "this market does not list the name" and "this market has
 *  nothing to compare the name against" are different answers that a bare `no-match` conflates. */

export type MarketDetection =
  | {
      readonly kind: 'match'
      readonly instrument: InstrumentRef
      /** What the market's own record files this name under, when it keeps one. Carried from
       *  detection because that lookup already holds the record, and the exposure caps a buy is
       *  sized against are grouped by it. */
      readonly sector?: string
      /** The benchmark basket the name sits in, where the market keeps one. Same reason as
       *  `sector`: the record is already in hand, and refetching it downstream would cost a read. */
      readonly indexTier?: string
      /** The record's own kind, carried for the same reason as `sector`: the detection lookup
       *  already holds the record, and a sleeve's ETF ceiling is measured by it. */
      readonly instrumentKind?: InstrumentKind
    }
  | { readonly kind: 'no-match'; readonly caveats?: readonly Caveat[] }

export interface Market {
  readonly manifest: MarketManifest
  readonly capabilities: MarketCapabilities
  candidacy(ticker: Ticker): TickerCandidacy
  detect(options: DetectInstrumentOptions): Promise<MarketDetection>
  factors(options: FactorRequest): Promise<FactorScore>
  levels(options: MarketLevelRequest): Promise<LevelResult>
  /** Absent on a market whose stops are entry-relative only. */
  readonly trail?: MarketTrail
  /** Absent on a market whose exchange sets no daily price limit. */
  readonly priceLimit?: MarketPriceLimit
  /** One instrument's price grid, for a market whose grid depends on the listing rather than on
   *  the manifest's one table. Absent where `manifest.tickSize` is every instrument's grid. */
  tickSizeOf?(options: TickSizeRequest): Promise<TickSizePolicy>
  /** Catalog names by ticker start or name; absent where the market keeps no catalog. */
  readonly search?: InstrumentSearch
}

export interface TickSizeRequest {
  readonly instrument: InstrumentRef
  readonly signal: AbortSignal
}

/** How a market raises a held position's stop as the price runs. */
export interface MarketTrail {
  /** Settled sessions the level reads, counting back from the day it is set for. */
  readonly sessions: number
  /** Where the stop stands after the last candle of a settled series, on the instrument's own price
   *  grid. Absent where the series is too short to read. */
  stopFor(candles: readonly Candle[], bounds: TrailBounds): number | undefined
}

/** What a trailed stop is held to beyond the policy's own ATR floor. */
export interface TrailBounds {
  readonly tickSize: TickSizePolicy
}

export interface ResolveMarketOptions {
  readonly ticker: Ticker
  readonly market?: MarketRef
  readonly signal: AbortSignal
}

export type MarketResolution =
  | {
      readonly kind: 'resolved'
      readonly market: Market
      readonly instrument: InstrumentRef
      readonly sector?: string
      readonly indexTier?: string
      /** The record's own kind, carried for the same reason as `sector`: the detection lookup
       *  already holds the record, and a sleeve's ETF ceiling is measured by it. */
      readonly instrumentKind?: InstrumentKind
      readonly caveats: readonly Caveat[]
    }
  | {
      readonly kind: 'market-not-registered'
      readonly ticker: Ticker
      readonly market: MarketRef
      readonly caveats: readonly Caveat[]
    }
  | { readonly kind: 'unavailable'; readonly ticker: Ticker; readonly caveats: readonly Caveat[] }
  | { readonly kind: 'unsupported'; readonly ticker: Ticker; readonly caveats: readonly Caveat[] }
  | {
      readonly kind: 'ambiguous-market'
      readonly ticker: Ticker
      readonly candidates: readonly MarketRef[]
      readonly caveats: readonly Caveat[]
    }

export interface MarketRegistry {
  register(market: Market): void
  close(): void
  find(ref: MarketRef): Market | null
  regionOwner(region: Region): Market | null
  resolve(options: ResolveMarketOptions): Promise<MarketResolution>
  list(): readonly Market[]
  regions(): readonly Region[]
  segments(): readonly PortfolioSegment[]
}

export interface ResolveSourceOptions<K extends SourceKind> {
  readonly kind: K
  readonly context: SourceContext
  readonly signal: AbortSignal
}

export interface SourceRegistry {
  register<K extends SourceKind>(source: Source<K>): void
  close(): void
  resolve<K extends SourceKind>(
    options: ResolveSourceOptions<K>
  ): Promise<SourceResult<SourceKindMap[K]>>
  /** Every routed provider, for a kind whose value is assembled from complementary sources rather
   *  than served whole by one. Results arrive in route order; the caller folds them. */
  resolveAll<K extends SourceKind>(
    options: ResolveSourceOptions<K>
  ): Promise<readonly SourceResult<SourceKindMap[K]>[]>
  list(): readonly SourceSummary[]
}
