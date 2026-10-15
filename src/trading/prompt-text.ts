/** Numbers as a model reads them: no locale, no separators, no glyphs. The display contract governs
 *  what a person sees, and a prompt is not that surface — but the three prompt builders still owe
 *  each other one spelling of the same fraction, or the same win rate reads two ways in one call. */
const PERCENT_PER_UNIT = 100
const PERCENT_DECIMALS = 1
const RATIO_DECIMALS = 2

/** A fraction as a percentage, one decimal: the resolution a cap or a reserve is set at. */
export function promptPercent(fraction: number): string {
  return `${(fraction * PERCENT_PER_UNIT).toFixed(PERCENT_DECIMALS)}%`
}

/** A fraction as a whole percentage, for a rate measured on a sample too small to claim decimals. */
export function promptWholePercent(fraction: number): string {
  return `${Math.round(fraction * PERCENT_PER_UNIT)}%`
}

/** As above, with the sign kept: a realized return reads as a direction first. */
export function promptSignedPercent(fraction: number): string {
  const rounded = Math.round(fraction * PERCENT_PER_UNIT)

  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

/** A dimensionless score — an agreement, a Brier — at the two decimals such scales are read on. */
export function promptRatio(value: number): string {
  return value.toFixed(RATIO_DECIMALS)
}
