import type { ConvictionBand } from '@/trading/kernel/conviction'

export interface CalibrationBucket {
  readonly convictionBand: ConvictionBand
  readonly resolvedCount: number
  readonly winCount: number
  readonly winRate?: number
  readonly meanReturnPct?: number
  /** Mean return of the winning rows and of the losing rows, each over its own side. Present with
   *  `winRate`; a side with no rows is absent rather than zero. */
  readonly meanWinPct?: number
  readonly meanLossPct?: number
  /** Rows in this band the resolver could price against the market's own benchmark. Its own
   *  sample: a band of thirty rows where eight carry a benchmark must not report a beat rate
   *  off eight. */
  readonly benchmarkComparedCount: number
  readonly benchmarkBeatCount: number
  readonly benchmarkBeatRate?: number
  /** Rows in this band whose debate stated a probability. Its own sample: a band can clear the
   *  minimum on resolved rows and fall short on stated ones. */
  readonly statedCount: number
  /** Mean squared distance between the stated probability and the realized win, 0 best. */
  readonly brier?: number
  readonly meanStatedProbability?: number
}
