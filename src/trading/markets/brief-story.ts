import type { BriefSectionRow } from '@/trading/kernel/operator/brief-section'
import type {
  StoryCandidate,
  StoryFact,
  StoryRole,
  StoryWatch,
  WatchEffect,
  WatchShape,
} from '@/trading/kernel/operator/brief-story'
import type { BreadthTrend } from '@/trading/markets/overview-rollups'
import { toRunKey } from '@/trading/kernel/operator/brief-story'

/** What a breadth story reads: the market's trend now, and as it stood `breadthShiftSessions`
 *  earlier. A full `MarketBreadth` satisfies it, as does a fold that measures only the trend. */
export interface BreadthStoryInputs {
  readonly breadth: BreadthTrend & { readonly aboveMa50Ratio: number }
  readonly breadthBefore?: BreadthTrend
}

/** The market's story numbers, in the units `VN_STORY_POLICY` documents. */
interface BreadthShiftPolicy {
  readonly breadthShift: number
  readonly breadthShiftSessions: number
  readonly breadthFollowThrough: number
  readonly horizonSessions: number
}

export interface WatchSpec {
  readonly shape: WatchShape
  readonly threshold: number
  readonly effect: WatchEffect
  readonly row?: StoryWatch['row']
  readonly horizonSessions?: number
}

export function detectBreadthShift(
  inputs: BreadthStoryInputs,
  policy: BreadthShiftPolicy
): StoryCandidate | undefined {
  const before = inputs.breadthBefore?.aboveMa50Ratio
  const { breadth } = inputs

  if (before === undefined) {
    return undefined
  }

  const now = breadth.aboveMa50Ratio
  const delta = now - before

  if (Math.abs(delta) < policy.breadthShift) {
    return undefined
  }

  const widening = delta > 0
  const code = widening ? 'breadth-widening' : 'breadth-narrowing'

  return {
    code,
    runKey: toRunKey(code),
    salience: salienceOf(Math.abs(delta), policy.breadthShift),
    facts: breadthShiftFacts(breadth, widening, policy.breadthShiftSessions),
    watches: buildWatches(
      [
        {
          shape: widening ? 'aboveMa50Ratio-above' : 'aboveMa50Ratio-below',
          threshold: now + (widening ? 1 : -1) * policy.breadthFollowThrough,
          effect: 'confirms',
        },
        {
          shape: widening ? 'aboveMa50Ratio-below' : 'aboveMa50Ratio-above',
          threshold: before,
          effect: 'refutes',
        },
      ],
      policy.horizonSessions
    ),
  }
}

function breadthShiftFacts(
  breadth: BreadthStoryInputs['breadth'],
  widening: boolean,
  sessions: number
): readonly StoryFact[] {
  const trend = breadth.indexToMa50Pct
  const against = trend !== undefined && (widening ? trend < 0 : trend > 0)

  return [
    fact({ aboveMa50Ratio: breadth.aboveMa50Ratio, sessions }, 'supports'),
    ...(breadth.newHighs === undefined || breadth.newLows === undefined
      ? []
      : [fact({ newHighs: breadth.newHighs, newLows: breadth.newLows }, 'supports')]),
    ...(against ? [fact({ indexToMa50Pct: trend }, 'contradicts')] : []),
  ]
}

/** The trigger's distance past its threshold, in thresholds, capped at one. */
export function salienceOf(value: number, threshold: number): number {
  return Math.min(1, Math.max(0, (value - threshold) / threshold))
}

export function fact(row: BriefSectionRow, role: StoryRole): StoryFact {
  return { row, role }
}

/** A spec without its own `horizonSessions` watches for the market's `horizonSessions`. */
export function buildWatches(
  specs: readonly WatchSpec[],
  horizonSessions: number
): readonly StoryWatch[] {
  return specs.map((spec) => ({
    shape: spec.shape,
    ...(spec.row === undefined ? {} : { row: spec.row }),
    threshold: spec.threshold,
    horizonSessions: spec.horizonSessions ?? horizonSessions,
    effect: spec.effect,
  }))
}
