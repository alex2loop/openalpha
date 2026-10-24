import type { SizedValuedBook, ValuedBook } from '@/trading/features/portfolio/types'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import { segmentEntries } from '@/trading/features/portfolio/folds/allocation'
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

/** A segment at zero held and zero wanted is dropped, as `/rebalance` drops it. Targets are
 *  rounded as the set `/rebalance` prints; a disabled segment's target is zero, which never moves
 *  another's share. */
export function toSegmentShares(book: ValuedBook, profile: UserProfile): readonly SegmentShare[] {
  const weights = apportionedSegmentWeights(book)
  const targets = segmentEntries(profile.segmentTargets).toSorted(([left], [right]) =>
    left.localeCompare(right)
  )
  const apportioned = apportion(
    targets.map(([, target]) => target),
    FRACTION_QUANTUM
  )

  return targets.flatMap(([segment, rawTarget], index) => {
    const target = apportioned[index] ?? rawTarget
    const weight = weights.get(segment) ?? 0

    return target === 0 && weight === 0 ? [] : [{ segment, weight, target, gap: weight - target }]
  })
}
