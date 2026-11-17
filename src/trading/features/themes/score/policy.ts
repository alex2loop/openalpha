import type { EvidenceKind, ThemeMaturity } from '@/trading/features/themes/types'

/** Everything outside the score files that moves a theme score. `check-strategy-version` digests
 *  `score/` whole, so a change here is a change to `SCORE_VERSION`. */

/** How much of the exposure rests on what is promised rather than what is booked: an emerging
 *  theme has little revenue yet, a mature one is mostly in the accounts (FTSE Russell). */
export const FORWARD_WEIGHT: Readonly<Record<ThemeMaturity, number>> = Object.freeze({
  emerging: 0.7,
  scaling: 0.5,
  mature: 0.3,
})
/** Ben-David et al.: thematic names were already overvalued when attention arrived. Both high
 *  together are crowded. */
export const CROWDED_EXCESS_RETURN = 0.3
export const CROWDED_PE_PERCENTILE = 80
/** Hard data can found a theme; a headline or a price move alone cannot. */
export const HARD_EVIDENCE_KINDS: ReadonlySet<EvidenceKind> = new Set(['macro', 'commodity'])
/** A theme reaches a few sectors clearly; more is a list, not a judgment. */
export const MAXIMUM_SECTORS = 3
export const MINIMUM_RATING = 1
export const MAXIMUM_RATING = 5
export const MAXIMUM_TARGET_PE = 200
