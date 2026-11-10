import type { TapeReading } from '@/trading/kernel/market/tape'
import type { AlignedFlow } from '@/trading/markets/equity-vn/tape/flows'
import {
  FLOW_PERSISTENCE_MINIMUM_SESSIONS,
  FLOW_PERSISTENCE_SESSIONS,
  FOREIGN_FLIP_Z,
  TAPE_RUN_MINIMUM_FRACTION,
  TAPE_RUN_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import { foreignFlowShares } from '@/trading/markets/equity-vn/tape/flows'
import { nSessionReturn } from '@/trading/markets/timeseries'

/** The two series a tape signal reads, for the one pass that builds a name's evidence. */
interface TapeEvidence {
  readonly closes: readonly number[]
  readonly aligned: readonly AlignedFlow[]
}

/** The flip fires only after a run: a desk stepping away from a name that has gone nowhere is a
 *  session, not a tell. */
export function tapeReadings(name: TapeEvidence): readonly TapeReading[] {
  const { closes, aligned } = name
  const run = nSessionReturn(closes, TAPE_RUN_SESSIONS)

  if (run === undefined || run < TAPE_RUN_MINIMUM_FRACTION) {
    return []
  }

  return foreignFlip(aligned, run)
}

function foreignFlip(aligned: readonly AlignedFlow[], run: number): readonly TapeReading[] {
  const shares = foreignFlowShares(aligned)
  const latest = shares.at(-1)
  const trailing = shares.slice(-FLOW_PERSISTENCE_SESSIONS - 1, -1)

  if (latest === undefined || trailing.length < FLOW_PERSISTENCE_MINIMUM_SESSIONS) {
    return []
  }

  const mean = average(trailing.map((entry) => entry.share))
  const deviation = standardDeviation(
    trailing.map((entry) => entry.share),
    mean
  )

  // A flip is the buyer leaving: foreign selling after weeks of buying. A buy day after a selling
  // stretch is a different fact and would read the caveat's words backwards.
  if (deviation === 0 || latest.share >= 0 || mean <= 0) {
    return []
  }

  return Math.abs(latest.share - mean) / deviation >= FOREIGN_FLIP_Z
    ? [{ signal: 'foreign-flip', day: latest.day, measure: latest.share, run }]
    : []
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function standardDeviation(values: readonly number[], mean: number): number {
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length

  return Math.sqrt(variance)
}
