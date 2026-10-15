import type { Caveat } from '@/trading/kernel/caveat'
import type { BandCounts, ConvictionBand } from '@/trading/kernel/conviction'
import type { ScreenCandidate } from '@/trading/kernel/market/market-capability'

/** The share of a scored board meant to sit at high, and at medium or better. Every market's cut
 *  points were fitted to this pair and `scripts/research-conviction-bands.ts` proposes new ones
 *  against it, so the design target lives beside the check rather than in the script that reads it. */
export const HIGH_BAND_TARGET_FRACTION = 0.05
export const MEDIUM_BAND_TARGET_FRACTION = 0.25

/** The share of a scored board `contested` is meant to name. It splits the low band, so it is fitted
 *  against the same script: the minority whose score is small because the factors cancelled, rather
 *  than the band's default word. Agreement is the score over the board's own factor dispersion, so a
 *  bar picked in the abstract lands wherever that dispersion happens to sit — which is how one bar
 *  came to claim seven names in ten. */
export const CONTESTED_TARGET_FRACTION = 0.2

/** How far past its target the top band may run before the cut points are stale rather than lucky.
 *  Three, because the one drift measured so far — a VN board re-broadening after the drawdown its
 *  cut points were fitted in — lands near a sixth of the board, and a smaller multiple would also
 *  fire on boards that are calibrated correctly. */
const HIGH_BAND_DRIFT_MULTIPLE = 3

/** Below this a board cannot resolve its own top band: one name is already the whole target share,
 *  so the ratio reports how short the board is rather than how it was scored. */
const MINIMUM_CALIBRATION_NAMES = 20

export function countBands(candidates: readonly ScreenCandidate[]): BandCounts {
  const counts: Record<ConvictionBand, number> = { low: 0, medium: 0, high: 0 }

  for (const candidate of candidates) {
    counts[candidate.composite.band] += 1
  }

  return counts
}

/** A board whose top band runs far wider than its design share is sizing more names at full
 *  conviction than the policy intends. Cut points are fitted to a market's past spread and that
 *  spread moves with the regime, so the board is the only thing that can report its own drift.
 *  One-sided: cut points gone too strict surface as a board with nothing worth buying, which the
 *  screen already says in its own words. */
export function convictionDriftCaveats(counts: BandCounts | undefined): readonly Caveat[] {
  if (counts === undefined) {
    return []
  }

  const scored = counts.low + counts.medium + counts.high

  if (scored < MINIMUM_CALIBRATION_NAMES) {
    return []
  }

  const share = counts.high / scored

  if (share <= HIGH_BAND_TARGET_FRACTION * HIGH_BAND_DRIFT_MULTIPLE) {
    return []
  }

  return [
    {
      code: 'market-data.conviction-drift',
      detail: { share, target: HIGH_BAND_TARGET_FRACTION },
    },
  ]
}
