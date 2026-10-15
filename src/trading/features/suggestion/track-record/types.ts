import type { ReviewMarkId } from '@/trading/features/suggestion/pipeline/review-marks'
import type { CalibrationBucket } from '@/trading/features/suggestion/track-record/calibration'
import type {
  CalculationVersion,
  OutcomeResolution,
  ResolvedActionableSuggestion,
  SuggestionId,
} from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { MarketRef, Ticker } from '@/trading/kernel/instrument'
import type { FocusKey } from '@/trading/kernel/operator/focus'

export interface OutcomeResolutionBatch {
  readonly results: readonly OutcomeResolution[]
  readonly nextCursor?: SuggestionId
}

export interface ListResolvedSuggestionsOptions {
  readonly resolvedAfter?: number
  readonly strategyVersion?: string
  /** Only these focuses' calls. Omitted, every focus is read. */
  readonly focusKeys?: readonly FocusKey[]
  readonly market?: MarketRef
  readonly ticker?: Ticker
  readonly limit: number
  readonly signal: AbortSignal
}

export interface TrackRecordOptions {
  readonly limit: number
  readonly strategyVersion?: string
  /** The focus whose record is read: the operator's own when absent. */
  readonly focusKey?: FocusKey
  readonly signal: AbortSignal
}

export interface TrackRecordVersionCount {
  readonly strategyVersion: string
  readonly calculationVersions: readonly CalculationVersion[]
  readonly resolvedCount: number
}

/** One debate model chain and how its calls resolved. A model swap splits the population here, so
 *  a blended win rate never hides which model earned it. */
export interface TrackRecordModelCount {
  readonly models: readonly string[]
  readonly resolvedCount: number
  readonly winCount: number
  readonly winRate?: number
}

/** One focus and how its calls resolved. The operator's own calls are `default`; an agent with its
 *  own `[focus]` has a record of its own, so two agents' views are never blended into one rate. */
export interface TrackRecordFocusCount {
  readonly focusKey: FocusKey
  readonly resolvedCount: number
  readonly winCount: number
  readonly winRate?: number
}

export interface ReviewSplit {
  readonly id: ReviewMarkId
  readonly markedCount: number
  readonly unmarkedCount: number
  /** Present together, and only when both sides cleared the minimum: a rate on one side alone
   *  compares against nothing. */
  readonly markedWinRate?: number
  readonly unmarkedWinRate?: number
}

/** Sequential contribution, not a compounded equity curve: each resolved row adds its size times its
 *  return, in suggestion order. `sizePctNav` is a fraction of NAV despite the name. Overlapping holds
 *  and cash drag are deliberately unmodeled, which the caveat states. */
export interface ShadowSummary {
  /** Cumulative NAV contribution as a fraction: each row adds `sizePctNav x returnPct`. */
  readonly totalContribution: number
  /** Worst peak-to-trough of that cumulative series, as a fraction of NAV. */
  readonly worstDrawdown: number
  readonly sizedCount: number
  readonly unsizedCount: number
  readonly caveats: readonly Caveat[]
}

/** The population the summary was drawn from, unbounded by the report window. Holds are excluded:
 *  the table forbids them an outcome, so they are standing plans rather than calls. */
export interface TrackRecordCoverage {
  readonly actionable: number
  readonly resolved: number
  readonly pending: number
  /** Pending rows on a market `canResolveOutcomes` refuses. These never leave `pending`. */
  readonly unresolvable: number
  /** Closed with no result - a rebuilt price history, or bars that no longer exist - so neither
   *  scored nor open. */
  readonly restated: number
  /** Closed because the order never filled: no trade, so neither scored nor open. */
  readonly unfilled: number
}

export interface TrackRecordSummary {
  readonly resolvedCount: number
  /** The distinct names behind `resolvedCount`, which already folds a repeat of a call still open:
   *  fewer names than calls means a name was called again after its earlier call closed. */
  readonly resolvedNameCount: number
  readonly winCount: number
  readonly lossCount: number
  readonly winRate?: number
  readonly meanReturnPct?: number
  readonly medianReturnPct?: number
  readonly benchmarkComparedCount: number
  readonly benchmarkBeatCount: number
  readonly benchmarkMeanReturnPct?: number
  readonly beatsBenchmarkMajority?: boolean
  readonly versions: readonly TrackRecordVersionCount[]
  readonly debateModels: readonly TrackRecordModelCount[]
  readonly focuses: readonly TrackRecordFocusCount[]
  readonly calibration: readonly CalibrationBucket[]
  readonly reviewSplits: readonly ReviewSplit[]
  readonly shadow: ShadowSummary
  readonly coverage: TrackRecordCoverage
  readonly caveats: readonly Caveat[]
}

export interface TrackRecordReport {
  readonly summary: TrackRecordSummary
  readonly recent: readonly ResolvedActionableSuggestion[]
}
