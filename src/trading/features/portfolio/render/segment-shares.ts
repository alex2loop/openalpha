import type { SizedValuedBook, ValuedBook } from '@/trading/features/portfolio/types'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import {
  currentSegmentWeights,
  segmentEntries,
} from '@/trading/features/portfolio/folds/allocation'
import { printedSegmentShares } from '@/trading/features/portfolio/render/segments'
import { apportion, FRACTION_QUANTUM } from '@/trading/render/number'

/** One segment against the policy it is held to, as fractions of NAV rounded as the chat prints
 *  them, so `gap` is the difference of the two printed figures. Positive is over target. */
interface SegmentShare {
  readonly segment: PortfolioSegment
  readonly weight: number
  readonly target: number
  readonly gap: number
}

/** The valued book with its segments set against the profile's targets. */
export interface PortfolioView extends SizedValuedBook {
  readonly shares: readonly SegmentShare[]
}

/** The weight column divides NAV over these segments, so it is rounded as a set rather than cell by
 *  cell, as `/rebalance` already rounds its own segment table: singly it printed 100,01%. Read by
 *  every line of this message that states a segment's weight, so none of them can round apart. */
export function apportionedSegmentWeights(book: ValuedBook): ReadonlyMap<PortfolioSegment, number> {
  const weights = apportion(
    book.segmentValues.map((entry) => entry.weightPctNav),
    FRACTION_QUANTUM
  )

  return new Map(
    book.segmentValues.map((entry, index) => [entry.segment, weights[index] ?? entry.weightPctNav])
  )
}

/** The rows `/rebalance` prints, rounded as it rounds them: `printedSegmentShares` drops a segment at
 *  zero held and zero wanted and apportions the targets over what is left, in the segment order its
 *  table uses (by name). A disabled segment's target is zero and moves nothing. The weight stays the
 *  book's own apportionment, so it reads the same as every other line that states it. */
export function toSegmentShares(book: ValuedBook, profile: UserProfile): readonly SegmentShare[] {
  const weights = apportionedSegmentWeights(book)
  const held = currentSegmentWeights(book)
  const rows = segmentEntries(profile.segmentTargets)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([segment, target]) => {
      const current = held.get(segment) ?? 0

      // No plan stands behind a view of the book: after the plan it is where it is now.
      return { segment, currentPctNav: current, afterPlanPctNav: current, targetPctNav: target }
    })

  return printedSegmentShares(rows).map(([{ segment }, printed]) => {
    const weight = weights.get(segment) ?? 0

    return { segment, weight, target: printed.targetPctNav, gap: weight - printed.targetPctNav }
  })
}
