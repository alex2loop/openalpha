/** How stock and sector reads scored in each bucket went on to do: the scorecard `/themes` prints
 *  under its report. */
export const SCORE_BUCKETS = Object.freeze(['high', 'middle', 'low'] as const)
export type ScoreBucket = (typeof SCORE_BUCKETS)[number]
/** The lowest score each bucket holds: 80 and up, 60 to 80, below 60. */
export const SCORE_BUCKET_FLOORS: Readonly<Record<ScoreBucket, number>> = Object.freeze({
  high: 80,
  middle: 60,
  low: 0,
})

/** A sector's outcome is the equal-weight average of the names read under it; a theme read is
 *  not measured. */
export const SCORECARD_LEVELS = Object.freeze(['sector', 'stock'] as const)
type ScorecardLevel = (typeof SCORECARD_LEVELS)[number]

export interface BucketResult {
  readonly bucket: ScoreBucket
  readonly reads: number
  /** Mean return over VN-Index, a fraction; absent while the bucket holds too few reads to judge. */
  readonly excessReturn?: number
}

export interface ScorecardLine {
  readonly level: ScorecardLevel
  readonly horizonMonths: number
  /** Highest bucket first. */
  readonly buckets: readonly BucketResult[]
  /** Each bucket beat the one below it; absent until every bucket can be judged. */
  readonly separates?: boolean
}

export interface ThemeScorecard {
  /** Only the horizons and levels with at least one resolved read. */
  readonly lines: readonly ScorecardLine[]
}
