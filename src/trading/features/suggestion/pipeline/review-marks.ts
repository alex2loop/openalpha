import type { ResolvedActionableSuggestion } from '@/trading/features/suggestion/types'
import type { CaveatCode } from '@/trading/kernel/caveat'

/** A decision a reviewer made or a stage reported that did not change the action. Whether it
 *  should have is what the split answers: a mark whose rows win as often as the rest is noise the
 *  operator can stop reading, and one whose rows win less is a stage that should lower. */
export const REVIEW_MARK_IDS = Object.freeze([
  'risk-lowered',
  'distribution-session',
  'crowded-side',
  'citation-unverified',
  'foreign-room-exhausted',
  'chasing-gap',
] as const)
export type ReviewMarkId = (typeof REVIEW_MARK_IDS)[number]

/** Every mark but the reviewer's verdict is a caveat the row carries. */
const MARK_CAVEATS = Object.freeze({
  'distribution-session': 'market.distribution-session',
  'crowded-side': 'suggestion.crowded-side',
  'citation-unverified': 'suggestion.citation-unverified',
  'foreign-room-exhausted': 'market.foreign-room-exhausted',
  'chasing-gap': 'suggestion.chasing-gap',
} as const satisfies Readonly<Record<Exclude<ReviewMarkId, 'risk-lowered'>, CaveatCode>>)

export function isMarked(row: ResolvedActionableSuggestion, id: ReviewMarkId): boolean {
  if (id === 'risk-lowered') {
    return row.debate?.mode === 'full' && row.debate.riskVerdict === 'lower'
  }

  const code = MARK_CAVEATS[id]

  return row.caveats.some((caveat) => caveat.code === code)
}
