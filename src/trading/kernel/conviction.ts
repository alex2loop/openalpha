/** Both `stages.ts` (the monotonicity guard) and `sizing.ts` (the sizing multiplier) need the same
 *  band ordering. One file owns it so the two can never drift. */
export const BAND_RANK: Readonly<Record<ConvictionBand, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
})

/** The two cut points a single factor's score is banded on. */
export const MILD_SCORE_AT = 0.2
export const EXTREME_SCORE_AT = 0.5

export const CONVICTION_BANDS = Object.freeze(['low', 'medium', 'high'] as const)
export type ConvictionBand = (typeof CONVICTION_BANDS)[number]

/** How many of a scored board landed in each band — the board's own report on the cut points that
 *  produced it. */
export type BandCounts = Readonly<Record<ConvictionBand, number>>

/** Multiplier applied to sizing headroom. Never above 1 — conviction can only shrink a position,
 *  matching the "conviction only lowers" invariant on the decision side. Chosen values; no backtest
 *  justifies 0.35/0.7 over a neighbouring split, the same calibration caveat gold's factor weights
 *  carry. */
export const CONVICTION_SIZING_SCALE: Readonly<Record<ConvictionBand, number>> = Object.freeze({
  low: 0.35,
  medium: 0.7,
  high: 1,
})

/** The single membership check every caller runs before trusting a band it did not produce — a
 *  stage decision, a sizing input, a persisted row. */
export function isConvictionBand(value: string): value is ConvictionBand {
  // Own-property check: `in` walks the prototype chain, so 'constructor' would pass as a band.
  return Object.hasOwn(BAND_RANK, value)
}

/** `steps` bands down, floored at `low`. Thin coverage and weak agreement lower conviction; nothing
 *  in the pipeline raises it. A caller holding several independent findings passes their count, so
 *  a name failing three admission gates is not discounted like one that failed a single gate. */
export function lowerBand(band: ConvictionBand, steps = 1): ConvictionBand {
  return CONVICTION_BANDS[Math.max(BAND_RANK[band] - steps, BAND_RANK.low)] ?? 'low'
}

/** What a call concludes, and how it ended. Both are read by the pipeline that decides them, the
 *  store that keeps them and the renderer that prints them, so the words live where all three can
 *  reach them rather than in the feature that happens to produce them. */
export const SUGGESTION_ACTIONS = Object.freeze(['buy', 'reduce', 'hold'] as const)
export type SuggestionAction = (typeof SUGGESTION_ACTIONS)[number]

export const OUTCOME_STATUSES = Object.freeze(['target', 'stop', 'expired'] as const)
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number]

/** Written to `outcome_status` with no return when a call's order never filled: there was no trade,
 *  so it has no result. Apart from `OUTCOME_STATUSES`, which are the results a call can score. */
export const UNFILLED_STATUS = 'unfilled'

/** What a call closed with no return says about why: its series could not be read, or its order
 *  never filled. */
export type UnscoredStatus = 'expired' | typeof UNFILLED_STATUS
