import type { Logger } from '@/core/logging/logger'
import type { Budget } from '@/core/types/budget'
import type { CapReason, RebalancePlanResult, ValuedBook } from '@/trading/features/portfolio/types'
import type { HeadlinesRead, SuggestionCitation } from '@/trading/features/suggestion/citation'
import type { DebateResult, ThesisBreak } from '@/trading/features/suggestion/debate/types'
import type { BookExposure } from '@/trading/features/suggestion/exposure'
import type { CalibrationBucket } from '@/trading/features/suggestion/track-record/calibration'
import type {
  PriorThesis,
  ResolvedActionableSuggestion,
  StoredSuggestion,
  Suggestion,
  SuggestionDirection,
  SuggestionId,
  SuggestionIdentity,
  SuggestionRequest,
} from '@/trading/features/suggestion/types'
import type {
  Caveat,
  EvidenceReduceReasonCode,
  HoldReasonCode,
  ReduceReasonCode,
} from '@/trading/kernel/caveat'
import type { LeanDebateReason, SuggestionPolicy } from '@/trading/kernel/config'
import type { FactorScore, TradeLevels } from '@/trading/kernel/factor'
import type {
  CurrencyCode,
  DailyPriceBand,
  InstrumentKind,
  InstrumentRef,
  MarketRef,
  PortfolioSegment,
  StrategyId,
  Ticker,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { MarketEvent, RegimeScale } from '@/trading/kernel/market/market-data'
import type { BookChange, ClosedRoundTrip } from '@/trading/kernel/operator/book'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import type { InvestmentHorizon, UserProfile } from '@/trading/kernel/operator/profile'
import type { StageRegistry } from '@/trading/markets/stage'
import type { Market, MarketManifest, MarketRegistry } from '@/trading/markets/types'

/** The narrow consumer-side seam the pipeline needs from the suggestion store: the reads that gate
 *  a run (identity, cooldown) and the writes that land its result. Declared by the consumer: the
 *  store satisfies it structurally, so a storage reshuffle cannot reach suggestion derivation. */
export interface SuggestionSink {
  findCompleted(identity: SuggestionIdentity, signal: AbortSignal): Promise<StoredSuggestion | null>
  findRecentCompleted(options: {
    readonly market: MarketRef
    readonly ticker: Ticker
    readonly strategyId: StrategyId
    readonly strategyVersion: string
    readonly focusKey: FocusKey
    readonly sinceDay: TradingDay
    readonly signal: AbortSignal
  }): Promise<StoredSuggestion | null>
  findPreviousThesis(options: {
    readonly market: MarketRef
    readonly ticker: Ticker
    readonly focusKey: FocusKey
    readonly beforeDay: TradingDay
    readonly signal: AbortSignal
  }): Promise<PriorThesis | null>
  /** The newest unresolved buy, else hold, on a name: the stop a held position is already planned
   *  against, which a re-run may raise and never lower. */
  findLatestExitPlan(options: {
    readonly market: MarketRef
    readonly ticker: Ticker
    /** Widens it to the newest row of any status, for the floor a new plan's stop must not sit
     *  under. */
    readonly includeResolved?: boolean
    /** The day the holding as it stands opened; older plans belong to a holding already closed. */
    readonly heldSince?: TradingDay
    readonly signal: AbortSignal
  }): Promise<StoredSuggestion | null>
  create(suggestion: StoredSuggestion, signal: AbortSignal): Promise<boolean>
  replace(options: {
    readonly previousId: SuggestionId
    readonly suggestion: StoredSuggestion
    readonly signal: AbortSignal
  }): Promise<boolean>
  listResolved(options: {
    readonly resolvedAfter?: number
    readonly calledOnOrBefore?: TradingDay
    readonly strategyVersion?: string
    readonly focusKeys?: readonly FocusKey[]
    readonly market?: MarketRef
    readonly ticker?: Ticker
    readonly action?: SuggestionDirection
    readonly limit: number
    readonly signal: AbortSignal
  }): Promise<readonly ResolvedActionableSuggestion[]>
}

/** How deep this run argues, and — when that is the shallow depth — which rule picked it. One
 *  field rather than a mode beside an optional reason, so a lean run cannot exist without one. */
export type DebateDepth =
  | { readonly mode: 'full' }
  | { readonly mode: 'lean'; readonly reason: LeanDebateReason }

export interface DebateInput {
  readonly request: SuggestionRequest
  /** Already resolved against the request's override: the depth that sliced the role budgets is
   *  the one that must pick the roles. */
  readonly depth: DebateDepth
  readonly draft: Suggestion
  /** The whole scored read, not just the rows: coverage and agreement are what a persona weighs
   *  when deciding how much the deterministic evidence supports at all. */
  readonly factors: FactorScore
  /** The realized record for this market and strategy version, by band. Read once per run and
   *  handed to both the debate and the sizer, so the two never describe different populations. */
  readonly calibration: readonly CalibrationBucket[]
  /** This name's own dated corporate actions inside the holding window: timing a persona must weigh
   *  but may not speculate past. */
  readonly upcomingEvents?: readonly MarketEvent[]
  /** The calendar read failed, which an empty `upcomingEvents` would otherwise read as nothing
   *  scheduled. */
  readonly calendarFailed?: true
  readonly name?: string
  readonly sector?: string
  readonly proposedLevels?: TradeLevels
  /** Read by the roles that decide, never by the two that argue: a researcher handed the book
   *  argues portfolio construction instead of this name's evidence, which is not its question. */
  readonly exposure?: BookExposure
  /** On an `over-cap` sale: which cap the plan measured the name past, on the whole book. */
  readonly saleCap?: CapReason
}

/** Either the completed debate, or the hold it collapsed into. A role that halts, exhausts its
 *  slice, or returns output its schema rejects stops the remaining calls; the pipeline persists the
 *  hold arm rather than inventing a partial debate. */
export type DebateOutcome =
  | {
      readonly kind: 'resolved'
      readonly result: DebateResult
      readonly thesis: string
      readonly citations: readonly SuggestionCitation[]
      readonly headlinesRead: HeadlinesRead
      readonly caveats: readonly Caveat[]
      /** Material claims that did not come back supported. None of them held the run, so they
       *  lower its conviction instead. */
      readonly unverifiedClaims: number
      /** Present only when an earlier thesis on this name stated conditions and some now hold. */
      readonly invalidatedPrior?: ThesisBreak
    }
  | {
      readonly kind: 'hold'
      readonly reasonCode: HoldReasonCode
      /** Present when every role answered and a later check rejected the body; a collapsed role
       *  leaves none. */
      readonly result?: DebateResult
      /** What the verifier could not support, so the hold explains itself. */
      readonly unsupportedClaims?: readonly string[]
      readonly caveats: readonly Caveat[]
      readonly headlinesRead: HeadlinesRead
    }

/** `budgets` is the exact per-role slice tuple for this one suggestion: the debate never reads or
 *  subdivides a parent budget. */
export type RunDebate = (
  input: DebateInput,
  budgets: readonly Budget[],
  signal: AbortSignal
) => Promise<DebateOutcome>

export type ResolvedDebate = Extract<DebateOutcome, { readonly kind: 'resolved' }>

export interface FinalizeInput {
  readonly draft: Suggestion
  readonly debate: ResolvedDebate
  readonly context: SuggestionPortfolioContext
  readonly manifest: MarketManifest
  /** Whether the market trails a held stop, which decides whether a buy banks a tranche early. */
  readonly trailsStop: boolean
  /** The macro ceiling on deployable capital, resolved once per run alongside the factors. */
  readonly regimeScale: number
  readonly calibration: readonly CalibrationBucket[]
  /** Median session turnover in the market's own currency, from the same bars the levels used. */
  readonly medianTurnover?: number
  /** The market's own sector for this name, when it keeps one. */
  readonly sector?: string
  /** The record's own kind, for the segment's ETF ceiling. */
  readonly instrumentKind?: InstrumentKind
  /** The instrument's own daily band, from the level read that resolved it. */
  readonly dailyBand?: DailyPriceBand
  readonly levels?: TradeLevels
  /** What the whole book already stands to lose at its planned stops. Absent where the book carried
   *  no NAV to be a share of. */
  readonly openRisk?: OpenRisk
  /** The direction the draft was built from, which is where a reduce's own share of the position
   *  is decided. Sizing reads it rather than re-deriving the plan's weight gap, so an evidence
   *  reduce cannot be sized as if it were a trim. */
  readonly direction: DraftDirection
  /** The run's single clock read, for the session an order placed now fills in. */
  readonly now: number
  readonly deps: SuggestionRunDeps
}

export interface Prepared {
  readonly market: Market
  readonly instrument: InstrumentRef
  readonly horizon: InvestmentHorizon
  readonly identity: SuggestionIdentity
  readonly context: SuggestionPortfolioContext
  readonly factors: FactorScore
  readonly levels?: TradeLevels
  readonly dailyBand?: DailyPriceBand
  readonly medianTurnover?: number
  readonly name?: string
  /** What the market files this name under, when it keeps a sector. Sizing weighs a buy against the
   *  book's existing exposure to it. */
  readonly sector?: string
  /** The record's own kind, for the segment's ETF ceiling. */
  readonly instrumentKind?: InstrumentKind
  readonly upcomingEvents: readonly MarketEvent[]
  readonly calendarFailed?: true
  readonly openRisk?: OpenRisk
  readonly direction: DraftDirection
  readonly draft: Suggestion
}

/** One portfolio read per `(user, day)`: the profile, the valued book, and the advice whose
 *  rebalance rows decide buy versus reduce. Absolute values stay inside deterministic sizing and
 *  never reach a persona prompt. */
/** A hold carries the reason the book gave for it and a reduce the reason it sells, so the draft
 *  never has to guess which of the ways a name can be acted on it is looking at. */
export type DraftDirection =
  | { readonly action: 'buy'; readonly coreFill?: true }
  | {
      readonly action: 'reduce'
      readonly reasonCode: ReduceReasonCode
      /** The share of the current holding to sell, in (0, 1]. */
      readonly saleFraction: number
      /** On an `over-cap` sale: which cap the name ran past. */
      readonly cap?: CapReason
    }
  | {
      readonly action: 'hold'
      readonly reasonCode: HoldReasonCode
      /** Present on an evidence hold: the reason the holding is cut for. */
      readonly reduceReasonCode?: EvidenceReduceReasonCode
    }

export interface OpenRisk {
  /** What the book loses if every planned stop is hit, as a fraction of NAV. */
  readonly pctNav: number
  /** Held names with no planned stop. Their downside is unbounded and not in `pctNav`, so the
   *  ceiling built on it is a floor. */
  readonly unplanned: readonly InstrumentRef[]
}

export interface SuggestionPortfolioContext {
  readonly profile: UserProfile
  /** False when nothing has been saved and every number in `profile` is a seed — a suggestion
   *  shaped by a policy nobody chose says so rather than reading as the operator's own. */
  readonly profileSaved: boolean
  readonly book: ValuedBook
  /** The smallest order each held instrument's venue accepts, keyed by `buildInstrumentKey`. A
   *  holding below its own floor is residue a full exit left behind: no trade clears it, so no
   *  suggestion plans around it. Empty where no venue publishes a catalog. */
  readonly minimumSizes: ReadonlyMap<string, number>
  /** The operator's closed round trips, oldest first, split at the same floors. */
  readonly closedRoundTrips: readonly ClosedRoundTrip[]
  readonly advice: RebalancePlanResult
  /** One macro read per segment, shared with the rebalance plan. An item is capped by the segment its
   *  own market sits in, so a defensive VN read cannot size a crypto order. */
  readonly regimes: ReadonlyMap<PortfolioSegment, RegimeScale>
  /** Market currency to base currency. Levels are quoted in the market's own currency while NAV and
   *  cash are in the book's base, so sizing cannot compare them without it. */
  readonly rateToBase: ReadonlyMap<CurrencyCode, number>
  /** Available cash each market's tradable venues hold, keyed by market. A market absent here has no
   *  venue that places orders, so its sizing is not bounded by cash at all. */
  readonly reachableCashBase: ReadonlyMap<MarketRef, number>
  /** The markets some venue holds. One outside it is read for reference only and never bought. */
  readonly heldMarkets: ReadonlySet<MarketRef>
}

interface SuggestionPortfolioReadOptions {
  /** The batch's one clock read. The portfolio service dates the book by the default region's
   *  calendar regardless of which market the item resolved to, so an instant is the honest input —
   *  a per-item day would key the shared read on something the read itself ignores. */
  readonly now: number
  readonly signal: AbortSignal
  /** The segments the run reads rows for. A batch widens this to every segment its items resolved
   *  to, so one read serves the batch and no other segment's macro is fetched. */
  readonly segments: readonly PortfolioSegment[]
}

/** The narrow consumer-side seam the pipeline needs from the portfolio service. Declared here, by
 *  the consumer; `app` binds the implementation. */
export interface SuggestionPortfolioReader {
  read(options: SuggestionPortfolioReadOptions): Promise<SuggestionPortfolioContext>
  /** How far the book moved since a stored suggestion was made, and whether this name's own rows
   *  did. The reuse gate asks before serving one back, and it exits before any `read`, so this stays
   *  the cheap query it is rather than the whole portfolio context. */
  bookChangeSince(instrument: InstrumentRef, from: number, signal: AbortSignal): Promise<BookChange>
}

export interface SuggestionRunDeps {
  readonly markets: MarketRegistry
  readonly stages: StageRegistry
  readonly store: SuggestionSink
  readonly portfolio: SuggestionPortfolioReader
  readonly policy: SuggestionPolicy
  readonly logger: Logger
  readonly runDebate: RunDebate
  /** What a round trip costs at the venue each market books to, as a fraction of the entry. */
  roundTripFeeFraction(market: MarketRef): number
  /** `name@version` of every skill admitted to this run; hashed into the calculation versions so a
   *  skill edit separates populations exactly as a strategy edit does. */
  readonly skillVersions?: readonly string[]
  /** `role@effort` for every persona, hashed into the calculation versions alongside the skills. */
  readonly personaVersions?: readonly string[]
}

export interface SuggestionRunOptions {
  readonly deps: SuggestionRunDeps
  readonly request: SuggestionRequest
  /** The exact per-role slice tuple for this one suggestion, pre-allocated by the caller. */
  readonly roleBudgets: readonly Budget[]
}
