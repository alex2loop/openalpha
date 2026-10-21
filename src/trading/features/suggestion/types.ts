import type { ChannelId } from '@/core/channels'
import type { AgentId, BrandTag, RunId, SessionId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { HeadlinesRead, SuggestionCitation } from '@/trading/features/suggestion/citation'
import type { StoredDebate, ThesisBreak } from '@/trading/features/suggestion/debate/types'
import type { HeldPosition } from '@/trading/features/suggestion/exposure'
import type { Caveat, HoldReasonCode, ReduceReasonCode } from '@/trading/kernel/caveat'
import type { DebateMode } from '@/trading/kernel/config'
import type { ConvictionBand, OutcomeStatus } from '@/trading/kernel/conviction'
import type { FactorComposite, FactorResult } from '@/trading/kernel/factor'
import type {
  CurrencyCode,
  InstrumentKind,
  InstrumentRef,
  MarketRef,
  StrategyId,
  Ticker,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { DealerBoard } from '@/trading/kernel/market/market-data'
import type { FocusKey, RunFocus } from '@/trading/kernel/operator/focus'
import type { InvestmentHorizon, ProfileStamp } from '@/trading/kernel/operator/profile'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import type { StageReporter } from '@/trading/kernel/surface/tool-progress'
import { UNDECIDED_HOLD_REASON_CODES } from '@/trading/kernel/caveat'
import { buildUuidV7Id, parseUuidV7Id } from '@/trading/kernel/instrument'

export type SuggestionId = string & BrandTag<'SuggestionId'>

export const SUGGESTION_DIRECTIONS = Object.freeze(['buy', 'reduce'] as const)
export type SuggestionDirection = (typeof SUGGESTION_DIRECTIONS)[number]

/** What a suggestion list shows: each name's standing verdict, the calls that closed, or every row
 *  (each day's call and the plan levels it set). */
export const SUGGESTION_LIST_STATUSES = Object.freeze(['open', 'ended', 'all'] as const)
export type SuggestionListStatus = (typeof SUGGESTION_LIST_STATUSES)[number]

export const SUGGESTION_UNSUPPORTED_REASONS = Object.freeze([
  'market-not-registered',
  'market-data-unavailable',
  'market-data-not-loaded',
  'ticker-not-supported',
  'ambiguous-market',
  'outside-focus',
] as const)
type SuggestionUnsupportedReason = (typeof SUGGESTION_UNSUPPORTED_REASONS)[number]

export const OUTCOME_PENDING_REASONS = Object.freeze([
  'insufficient-bars',
  'expiry-not-reached',
  'entry-resting',
] as const)
type OutcomePendingReason = (typeof OUTCOME_PENDING_REASONS)[number]
type OutcomeUnscorableReason = 'bars-missing' | 'series-restated' | 'never-filled'

export interface CalculationVersion {
  readonly name: string
  readonly version: string
}

export interface SuggestionQuote {
  readonly price: number
  /** Percent-valued: 2.5 means +2.5% on the day. */
  readonly changePct?: number
  readonly observedAt: number
  /** The quoting market's currency, so a bare price never reads in the wrong one (2.500 as VND). */
  readonly currency: CurrencyCode
  /** Both sides, where the price came off a dealer board: a buy's levels sit on its buy price. */
  readonly board?: DealerBoard
}

/** How much cheaper the sessions after a reference close have historically been, over the same
 *  series the levels were built from. Prices, never fills: a daily bar says the market traded
 *  there, not that a resting order would have been filled there. */
export interface PullbackStat {
  readonly waitSessions: number
  readonly holdSessions: number
  /** Percent-valued: -1.2 means the window's cheapest session typically sat 1.2% below its close.
   *  `waitEdgePct` is priced at this discount, floored at the reference itself. */
  readonly medianBestPct: number
  /** Percentage points an order resting at `medianBestPct` returned above buying at the reference
   *  close, over the holding window, counting a window that never reached the limit as no position
   *  at all. Priced at that one limit rather than at each window's own low, which is a fill no
   *  order can be placed at. */
  readonly waitEdgePct: number
}

interface SuggestionBase {
  readonly instrument: InstrumentRef
  readonly at: TradingDay
  /** The newest settled session the factors and levels were read from. Behind `at` on every
   *  intraday run and all day on a continuous market, where `at` is the day the call was priced.
   *  Absent only when no bar series reached the run. */
  readonly evidenceThrough?: TradingDay
  readonly authoredLocale: Locale
  /** The policy this run was sized and gated under. Stored, not re-read: a replayed suggestion
   *  states the profile its numbers came from, not the one in force when it is read. */
  readonly profile: ProfileStamp
  /** The segment horizon the stop distance was sized for, as it stood on the run day. */
  readonly horizon: InvestmentHorizon
  readonly strategyId: StrategyId
  readonly strategyVersion: string
  /** The focus this call was made under: `default` drives the book, any other is a second opinion. */
  readonly focusKey: FocusKey
  readonly calculationVersions: readonly CalculationVersion[]
  readonly conviction: ConvictionBand
  readonly citations: readonly SuggestionCitation[]
  /** Absent when no debate ran, so no evidence was read - a gate block ends the run first. */
  readonly headlinesRead?: HeadlinesRead
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
  /** Every suggestion runs the factor pipeline, so the scored read is always present. */
  readonly factorScores: readonly FactorResult[]
  /** The fold over those rows, which is what chose the direction and the band. */
  readonly composite: FactorComposite
  /** The benchmark basket the name sat in that day, stored because an index is rebalanced. */
  readonly indexTier?: string
  /** The record's own kind: only the row can say which of a batch's buys the ETF ceiling bounds. */
  readonly instrumentKind?: InstrumentKind
  /** Carried from the levels the row was priced on: its stop is a review level, not an exit. */
  readonly reviewOnly?: true
  /** What the book already held of this name. On both arms: a hold on a name the operator owns is
   *  exactly where knowing the holding changes what they do about it. */
  readonly held?: HeldPosition
  /** The quote the run priced against, when the market published one. Stored, not refetched: a
   *  replayed suggestion shows the price its levels were built from, not today's. */
  readonly quote?: SuggestionQuote
  /** Whether waiting for a better price has paid for this name; absent on a short series. */
  readonly pullback?: PullbackStat
  /** Absent when a gate block or a collapsed debate ended the run before a debate result existed. */
  readonly debate?: StoredDebate
  /** The reviewing role's stated P(positive return in the window). Absent when no debate concluded. */
  readonly probability?: number
  /** An earlier thesis this run found broken. On both arms: the operator carries it regardless. */
  readonly invalidatedPrior?: ThesisBreak
  /** Share banked at the take-profit, stamped on every row framed as a buy so a holder is told the
   *  split a fresh entry is. Stored: a later profile edit changes neither the plan nor the grade. */
  readonly takeProfitTranchePct?: number
  /** What would make this call wrong, checked by the next run. On both arms: a hold is where the
   *  operator most needs to know what to watch for, having been told to do nothing. */
  readonly invalidators?: readonly string[]
  /** Why the name is sold down: a reduce's reason, or the evidence a hold is cut for. */
  readonly reduceReasonCode?: ReduceReasonCode
  /** A held name's standing stop this run raised: an order resting at an exchange stays there. */
  readonly raisedStopFrom?: number
  /** On a held name framed as a sale, the exits its standing plan names. */
  readonly standingExit?: { readonly stop: number; readonly takeProfit: number }
  /** On a held name whose first tranche is unsold, the take-profit its standing plan set. The fresh
   *  `takeProfit` beside it prices a new entry and is the one gates and the scorer read. */
  readonly standingTakeProfit?: number
}

export interface ActionableSuggestion extends SuggestionBase {
  readonly action: 'buy' | 'reduce'
  readonly thesis: string
  readonly entry: number
  readonly stop: number
  readonly target: number
  readonly takeProfit: number
  readonly riskReward: number
  /** Absent when the book carries no value to size against. Sizing is advisory — the action comes
   *  from the evidence, so an operator with no ledger still gets the call and the levels. */
  readonly sizePctNav?: number
  /** Whole units, lot-floored: what the operator types into an order. Present with `sizePctNav`. */
  readonly units?: number
  /** What the caps alone allowed, when conviction and intent scaled the order under it. This is
   *  the number the rebalancer fills to, so the two surfaces stop disagreeing silently. */
  readonly policyUnits?: number
  /** What the plan wants this name to weigh. Present on a reduce the plan steered; absent on a buy
   *  and on a reduce no plan row produced. */
  readonly targetPctNav?: number
  /** The session the order fills in: the day its fill is recorded against. */
  readonly orderSession?: TradingDay
  /** Absent, `entry` is an order that fills when placed. */
  readonly restingEntry?: RestingEntry
  /** What T+N means for this exact buy. Absent on a reduce and on a market that declares no band. */
  readonly settlement?: SettlementNote
  /** The order session's band, on a reduce too; absent where the market declares none. */
  readonly priceBand?: PriceBandNote
  /** The volatility the stop was placed against, in price units. Absent when no levels were priced. */
  readonly atr?: number
  /** Where this order leaves the sector it belongs to. Absent when the name declares no sector or
   *  the book carried no value to weigh it against. */
  readonly concentration?: ConcentrationNote
}

/** The sector weight this order lands on and the cap it is measured against — the ceiling that
 *  sized it is reported as a caveat, this is where the book sits after acting. */
export interface ConcentrationNote {
  readonly sector: string
  readonly afterPctNav: number
  readonly capPctNav: number
}

/** A buy limit resting below the quote the call was priced at: `entry` is the limit, and the order
 *  stands through `until`, the last session it may fill in. */
export interface RestingEntry {
  /** The run over `runSessions` that rested it, as a fraction. */
  readonly run: number
  readonly runSessions: number
  readonly until: TradingDay
}

/** The first day the shares can be sold, and how far the price can legally fall before that day
 *  arrives - each session between capped by the market's daily band. */
export interface SettlementNote {
  readonly sellableFrom: TradingDay
  readonly worstCaseDrawdownPct: number
}

/** The order session's band, resolved at draft time because the reference close it applies to
 *  does not survive into the stored row. */
export interface PriceBandNote {
  readonly floor: number
  readonly ceiling: number
  /** Fractions, as the venue's own policy states them: 0.07 is a 7% limit. */
  readonly maximumUpPct: number
  readonly maximumDownPct: number
}

/** A hold reports the levels when the market computed them: the deterministic read is what the
 *  operator asked for, and withholding it because the debate or a stage said no leaves the run
 *  with nothing to show for the work it already paid for. Present together or not at all. */
export interface HoldSuggestion extends SuggestionBase {
  readonly action: 'hold'
  /** The side the levels and debate were framed against: a reduce demoted to hold keeps `reduce`,
   *  so no renderer labels an exit's levels as a buy. */
  readonly direction: SuggestionDirection
  readonly thesis?: string
  readonly entry?: number
  readonly stop?: number
  readonly target?: number
  readonly takeProfit?: number
  readonly riskReward?: number
  readonly holdReasonCodes: readonly HoldReasonCode[]
  /** The material claims the evidence could not carry. Present only on a `claim-unverified` hold. */
  readonly unsupportedClaims?: readonly string[]
}

export type Suggestion = ActionableSuggestion | HoldSuggestion

interface StoredSuggestionFields {
  readonly id: SuggestionId
  readonly createdAt: number
  /** The stop the daily trail has raised the plan to. Never below `stop`, only on a plan whose
   *  position is long, and never read by the outcome scorer, which scores the call as it was
   *  made. */
  readonly trailingStop?: number
}

export interface SuggestionOutcome {
  readonly status: OutcomeStatus
  readonly resolvedAt: number
  readonly exitDay: TradingDay
  /** A fraction despite the name: 0.05 is a five percent round trip, net of fees. Renders through
   *  the `*Fraction` family — the `*Percent` one would divide it by a hundred again. */
  readonly returnPct: number
  /** A fraction, on the same scale as `returnPct`. */
  readonly benchmarkReturnPct?: number
  /** Which crossing rule scored this row; absent on rows resolved before the rule was versioned.
   *  Reported as a calculation version so two rules never blend into one win rate. */
  readonly formulaVersion?: string
}

/** `restatedAt`: the call was closed with no result - a rebuilt price history, or bars that no
 *  longer exist - so it neither scores nor stands. `unfilledAt`: its order never filled, so there
 *  was no trade to score. */
export type StoredSuggestion =
  | (ActionableSuggestion &
      StoredSuggestionFields & {
        readonly outcome?: SuggestionOutcome
        readonly restatedAt?: number
        readonly unfilledAt?: number
      })
  | (HoldSuggestion & StoredSuggestionFields & { readonly outcome?: never })

export type ResolvedActionableSuggestion = ActionableSuggestion &
  StoredSuggestionFields & { readonly outcome: SuggestionOutcome }

export interface SuggestionIdentity {
  readonly strategyId: StrategyId
  readonly strategyVersion: string
  readonly focusKey: FocusKey
  readonly market: MarketRef
  readonly ticker: Ticker
  readonly asOf: TradingDay
}

export interface SuggestionRequest {
  readonly locale: Locale
  readonly channel: ChannelId
  readonly billingSessionId: SessionId | null
  readonly parentRunId?: RunId
  /** The focus the call is made under. The operator's own surfaces pass `DEFAULT_RUN_FOCUS`. */
  readonly focus: RunFocus
  /** The agent asking, when one did; the focus it used is recorded against it. */
  readonly agentId?: AgentId
  /** The agent whose daily cap the run's model spend counts against. Absent bills to the persona. */
  readonly billingAgentId?: AgentId
  readonly ticker: Ticker
  readonly market?: MarketRef
  /** Overrides the configured debate mode for this one request. */
  readonly debateMode?: DebateMode
  /** Operator-only: runs past the reuse and cooldown gates and supersedes the day's stored row. */
  readonly force?: boolean
  readonly now: number
  readonly signal: AbortSignal
  /** Forwarded from the invoking surface; the pipeline reports stage keys through it. */
  readonly progress?: StageReporter
}

export type SuggestionRunResult =
  | {
      readonly kind: 'completed'
      readonly suggestion: StoredSuggestion
      readonly reused: boolean
    }
  | {
      readonly kind: 'unsupported'
      readonly ticker: Ticker
      readonly reason: SuggestionUnsupportedReason
      /** The market the request named, when naming it is what failed. */
      readonly market?: MarketRef
      readonly candidateMarkets?: readonly MarketRef[]
      /** The calling agent's focus in words, for `outside-focus`. The tool fills it: the run knows no
       *  locale to say it in. */
      readonly focusLabel?: string
    }
  | {
      readonly kind: 'cooldown'
      readonly previous: StoredSuggestion
      readonly eligibleAfter: TradingDay
    }
  /** The item threw past every stage guard — most likely persistence after a full debate. Not a
   *  hold: a hold means "evaluated and rejected", while this means the evaluation never got
   *  recorded, and the caller may safely rerun it (identity-keyed create is idempotent). */
  | {
      readonly kind: 'error'
      readonly ticker: Ticker
      readonly market?: MarketRef
      readonly message: string
    }

export type OutcomeResolution =
  | { readonly kind: 'resolved'; readonly outcome: SuggestionOutcome }
  | { readonly kind: 'pending'; readonly reason: OutcomePendingReason }
  /** The bars that would score the call no longer exist or no longer share its price scale, or
   *  its order never filled, so it was closed without a result. */
  | { readonly kind: 'unscorable'; readonly reason: OutcomeUnscorableReason }

/** The actionable arm as stored: the outcome daemon, the track record, and the renderer only ever
 *  work with these. */
export type ActionableStoredSuggestion = Extract<
  StoredSuggestion,
  { readonly action: 'buy' | 'reduce' }
>

/** The most recent actionable call on a name, and what it said would break it. Read on a later run
 *  only, so `at` is always an earlier day than the run reading it. */
export interface PriorThesis {
  readonly at: TradingDay
  readonly invalidators: readonly string[]
}

/** The side a suggestion's levels and debate were framed against: an actionable row states it as
 *  its action; a hold recorded it at draft time. */
export function framedDirectionOf(suggestion: Suggestion): SuggestionDirection {
  return suggestion.action === 'hold' ? suggestion.direction : suggestion.action
}

/** A run whose debate never answered (an unset key, a failed role, no budget left): it decided
 *  nothing, so nothing of it is stored and the plan already standing keeps watching the name. */
export function isInconclusive(suggestion: Suggestion): boolean {
  return (
    suggestion.debate === undefined &&
    suggestion.caveats.some((caveat) => caveat.code === 'suggestion.debate-degraded')
  )
}

/** A levels-only row the system wrote for a position the operator booked: the plan the name is
 *  watched against until a call replaces it. Not a verdict, so no header may read it as one. */
export function isRecordedPlan(suggestion: StoredSuggestion): boolean {
  return suggestion.action === 'hold' && suggestion.holdReasonCodes.includes('recorded-entry')
}

/** The stop a held position is planned against today: the trailed level where one has been set, the
 *  plan's own otherwise. Every surface that prints or arms a stop reads this, so none can drift. */
export function planStopOf(suggestion: ActionableStoredSuggestion): number
export function planStopOf(suggestion: StoredSuggestion): number | undefined
export function planStopOf(suggestion: StoredSuggestion): number | undefined {
  return suggestion.trailingStop ?? suggestion.stop
}

/** The take-profit a held position is planned against; a row priced before plans named a nearer one
 *  banks at its target. */
export function planTakeProfitOf(suggestion: StoredSuggestion): number | undefined {
  return suggestion.standingTakeProfit ?? suggestion.takeProfit ?? suggestion.target
}

/** Whether a row's stop is an exit to arm or a level to review against. The market decides when it
 *  prices the levels; every reader of a stop asks this, so none arms what another calls a review. */
export function armsExit(row: { readonly reviewOnly?: true }): boolean {
  return row.reviewOnly !== true
}

/** A row that records a failure to run rather than a decision, so a later run of the same day may
 *  replace it instead of serving it back. */
export function isUndecidedHold(suggestion: StoredSuggestion): boolean {
  return (
    suggestion.action === 'hold' &&
    suggestion.holdReasonCodes.some((code) => UNDECIDED_HOLD_REASON_CODES.has(code))
  )
}

/** Whether a row is an analyst's call, one that may vote in an agreement measure: neither a plan the
 *  system recorded nor a hold that records a failure to run. */
export function isAnalystCall(suggestion: StoredSuggestion): boolean {
  return !(isRecordedPlan(suggestion) || isUndecidedHold(suggestion))
}

export function suggestionId(raw: string): SuggestionId {
  return parseUuidV7Id<SuggestionId>(raw, 'SuggestionId')
}

export function buildSuggestionId(now: number): SuggestionId {
  return buildUuidV7Id<SuggestionId>(now, 'SuggestionId')
}
