import type { FactorComposite } from '@/trading/kernel/factor'
import type { ScreenCandidate } from '@/trading/kernel/market/market-capability'

/** The board's verdict on one name, distinct from `ScoreBand` (one factor's strength) and
 *  `ConvictionBand` (how much the sizer may lean on it): this is what the operator reads. */
export const SCREEN_RATINGS = Object.freeze([
  'strong-buy',
  'buy',
  'hold',
  'contested',
  'avoid',
  'strong-avoid',
  'inconclusive',
] as const)
export type ScreenRating = (typeof SCREEN_RATINGS)[number]

/** The same bars, in the same order, that `scoreDirection` drafts on, so a board never rates a name
 *  one way and `/suggest` acts on it another: too little evidence, then factors pulling hard against
 *  each other, then the draft floors. The high band only sharpens a buy or an avoid into a strong
 *  one; it never decides the direction. */
function ratingOf(composite: FactorComposite): ScreenRating {
  if (composite.coverageBelowMinimum) {
    return 'inconclusive'
  }

  if (composite.agreementBelowMinimum) {
    return 'contested'
  }

  const strong = composite.band === 'high'

  if (composite.bullish) {
    return strong ? 'strong-buy' : 'buy'
  }

  if (composite.bearish) {
    return strong ? 'strong-avoid' : 'avoid'
  }

  return 'hold'
}

/** The one owner of what a screened row claims, so the board, its "nothing clears the buy bar" line
 *  and the agent's payload cannot put three verdicts on one name. The rank itself is untouched: the
 *  board stays settled evidence, and only the verdict answers to the live price. */
export function screenRating(
  candidate: Pick<ScreenCandidate, 'composite' | 'caution'>
): ScreenRating {
  const rating = ratingOf(candidate.composite)

  return candidate.caution === undefined ? rating : lowerRating(rating)
}

/** One step down, never up, the same direction `lowerBand` moves. Only the two buy ratings move —
 *  everything weaker already sits at or below a hold, and `inconclusive` reports that the model did
 *  not speak, which no price can answer for it. */
function lowerRating(rating: ScreenRating): ScreenRating {
  return rating === 'strong-buy' || rating === 'buy' ? 'hold' : rating
}
