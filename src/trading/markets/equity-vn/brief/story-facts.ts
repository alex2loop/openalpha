import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketBreadth, MarketRange } from '@/trading/kernel/market/market-overview'
import type {
  BriefSectionKind,
  BriefSectionResult,
  BriefSectionRow,
} from '@/trading/kernel/operator/brief-section'
import type {
  StoryFact,
  StoryRole,
  StoryWatch,
  WatchEffect,
  WatchShape,
} from '@/trading/kernel/operator/brief-story'
import { VN_STORY_POLICY } from '@/trading/markets/equity-vn/brief/story-policy'
import {
  VN_INDEX_TICKER,
  VN_MARKET_REF,
  VN30_INDEX_TICKER,
  VN100_INDEX_TICKER,
} from '@/trading/markets/equity-vn/policy'

/** What the detectors may read. Built once from the settled session, never from a live price, so
 *  every fact in one candidate shares a day. */
export interface StoryInputs {
  readonly session: TradingDay
  /** In percent, the unit of `changePct`. */
  readonly indexMovePct: number
  readonly vn30MovePct?: number
  readonly vn100MovePct?: number
  readonly breadth: MarketBreadth & { readonly aboveMa50Ratio: number }
  readonly breadthBefore?: MarketBreadth
  readonly turnoverRatio?: number
  readonly turnoverSessions?: number
  readonly windowForeignNet?: number
  readonly windowTurnover?: number
  readonly sessionForeignNet?: number
  readonly range?: MarketRange
  /** The futures basis row, only when it is dated the story session. */
  readonly basis?: BriefSectionRow
  readonly sections: readonly BriefSectionResult[]
}

interface WatchSpec {
  readonly shape: WatchShape
  readonly threshold: number
  readonly effect: WatchEffect
  readonly row?: StoryWatch['row']
  readonly horizonSessions?: number
}

/** The trigger's distance past its threshold, in thresholds, capped at one. */
export function salienceOf(value: number, threshold: number): number {
  return Math.min(1, Math.max(0, (value - threshold) / threshold))
}

export function fact(row: BriefSectionRow, role: StoryRole): StoryFact {
  return { row, role }
}

export function buildWatches(specs: readonly WatchSpec[]): readonly StoryWatch[] {
  return specs.map((spec) => ({
    shape: spec.shape,
    ...(spec.row === undefined ? {} : { row: spec.row }),
    threshold: spec.threshold,
    horizonSessions: spec.horizonSessions ?? VN_STORY_POLICY.horizonSessions,
    effect: spec.effect,
  }))
}

/** The index's own move, then the two wider indexes that say who carried it. */
export function moveFacts(inputs: StoryInputs): readonly StoryFact[] {
  return [
    fact({ ticker: VN_INDEX_TICKER, changePct: inputs.indexMovePct }, 'supports'),
    ...optionalMoveFact(VN30_INDEX_TICKER, inputs.vn30MovePct),
    ...optionalMoveFact(VN100_INDEX_TICKER, inputs.vn100MovePct),
  ]
}

export function turnoverFact(inputs: StoryInputs, role: StoryRole): readonly StoryFact[] {
  const { turnoverRatio, turnoverSessions } = inputs

  if (turnoverRatio === undefined) {
    return []
  }

  const sessions = turnoverSessions === undefined ? {} : { sessions: turnoverSessions }

  return [fact({ turnoverRatio, ...sessions }, role)]
}

export function vn30Fact(inputs: StoryInputs): readonly StoryFact[] {
  return optionalMoveFact(VN30_INDEX_TICKER, inputs.vn30MovePct)
}

/** The rows of the first ready VN section of a kind. A kind another market also publishes must not
 *  answer for this one. */
export function vnRows(
  sections: readonly BriefSectionResult[],
  kind: BriefSectionKind
): readonly BriefSectionRow[] {
  const section = sections.find(
    (candidate) => candidate.kind === kind && candidate.market === VN_MARKET_REF
  )

  return section?.status === 'ready' ? section.rows : []
}

function optionalMoveFact(ticker: string, changePct: number | undefined): readonly StoryFact[] {
  return changePct === undefined ? [] : [fact({ ticker, changePct }, 'supports')]
}
