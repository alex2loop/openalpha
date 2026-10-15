import type {
  ScoreConfidence,
  ScorePart,
  ThemeReadLevel,
  ThemeScore,
} from '@/trading/features/themes/types'
import { clamp } from '@/trading/markets/factor-scoring'

/** Stored on every run, so a change of weights or scales splits the recorded population. */
export const SCORE_VERSION = 'theme-score-1.0.0'
export const SCORE_SCALE = 100
/** Below half its weight read, a score is a fragment: the read stays unscored. */
const MINIMUM_SCORED_COVERAGE = 0.5
/** High: nearly every part read and three cited figures. Parts measure different things, so how
 *  far apart they sit is a trade-off, never doubt about the read. */
const HIGH_CONFIDENCE_COVERAGE = 0.9
const HIGH_CONFIDENCE_FIGURES = 3
/** Low: a third of the weight unread, or no cited figure at all. */
const LOW_CONFIDENCE_COVERAGE = 0.7

interface PartWeight {
  readonly part: ScorePart
  readonly weight: number
}

/** The spec's priors; each level sums to 100. */
const SCORE_WEIGHTS: Readonly<Record<ThemeReadLevel, readonly PartWeight[]>> = Object.freeze({
  theme: [
    { part: 'probability', weight: 30 },
    { part: 'opportunity', weight: 20 },
    { part: 'duration', weight: 15 },
    { part: 'evidence', weight: 20 },
    { part: 'crowding', weight: 15 },
  ],
  sector: [
    { part: 'linkage', weight: 20 },
    { part: 'growth', weight: 20 },
    { part: 'criteria', weight: 30 },
    { part: 'valuation', weight: 15 },
    { part: 'crowding', weight: 15 },
  ],
  stock: [
    { part: 'context', weight: 15 },
    { part: 'exposure', weight: 15 },
    { part: 'earnings', weight: 20 },
    { part: 'quality', weight: 15 },
    { part: 'valuation', weight: 25 },
    { part: 'risk', weight: 10 },
  ],
})

interface ScoreReading {
  readonly parts: ThemeScore['parts']
  /** Distinct figures the read's own case cites, apart from the stories. */
  readonly citedFigures: number
  /** The parts this read can have at its stage; all of its level's when absent. A part outside it
   *  is not applicable yet, so it lowers neither the score nor the coverage. */
  readonly applicable?: readonly ScorePart[]
}

export interface PartScale {
  /** The reading that scores 0. */
  readonly zeroAt: number
  /** The reading that scores 1; below `zeroAt` when a lower reading is better. */
  readonly fullAt: number
}

interface ScoreChange {
  readonly level: ThemeReadLevel
  readonly current: ThemeScore
  readonly previous: ThemeScore
}

/** The weighted mean of the parts that were read, on 0-100. A part that could not be read drops
 *  out of the weights rather than counting as zero, and counts against the coverage. */
export function buildScore(level: ThemeReadLevel, reading: ScoreReading): ThemeScore | undefined {
  const { applicable } = reading
  const weights = SCORE_WEIGHTS[level].filter(
    (entry) => applicable === undefined || applicable.includes(entry.part)
  )
  const read = weights.flatMap(({ part, weight }) => {
    const value = reading.parts[part]

    return value === undefined ? [] : [{ weight, value }]
  })
  const covered = sumOf(read.map((entry) => entry.weight))
  const coverage = covered / sumOf(weights.map((entry) => entry.weight))

  if (read.length === 0 || coverage < MINIMUM_SCORED_COVERAGE) {
    return undefined
  }

  const weighted = sumOf(read.map((entry) => entry.weight * entry.value))

  return {
    value: Math.round((SCORE_SCALE * weighted) / covered),
    confidence: toConfidence(coverage, reading.citedFigures),
    parts: reading.parts,
  }
}

/** A reading placed on 0-1 between the two ends of its scale, clamped at both. */
export function toPartValue(value: number, scale: PartScale): number {
  return clamp((value - scale.zeroAt) / (scale.fullAt - scale.zeroAt), 0, 1)
}

/** The part whose change moved the score most since the previous run, among the parts read on
 *  both that moved the way the score did; none when no such part moved. */
export function toMainDriver(change: ScoreChange): ScorePart | undefined {
  const direction = Math.sign(change.current.value - change.previous.value)
  const moves = SCORE_WEIGHTS[change.level].flatMap(({ part, weight }) => {
    const now = change.current.parts[part]
    const before = change.previous.parts[part]

    return now === undefined || before === undefined || Math.sign(now - before) !== direction
      ? []
      : [{ part, size: Math.abs(weight * (now - before)) }]
  })

  return moves.toSorted((left, right) => right.size - left.size)[0]?.part
}

/** Callers pass at least one value. */
export function meanOf(values: readonly number[]): number {
  return sumOf(values) / values.length
}

function toConfidence(coverage: number, citedFigures: number): ScoreConfidence {
  if (coverage < LOW_CONFIDENCE_COVERAGE || citedFigures === 0) {
    return 'low'
  }

  return coverage >= HIGH_CONFIDENCE_COVERAGE && citedFigures >= HIGH_CONFIDENCE_FIGURES
    ? 'high'
    : 'medium'
}

function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
