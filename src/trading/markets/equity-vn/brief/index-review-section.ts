import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/equity-vn/brief/context'
import { absent, ready } from '@/trading/markets/equity-vn/brief/sections'
import { nextIndexReview } from '@/trading/markets/equity-vn/index-review'

/** The next rebalance session, derived from the review rule rather than a maintained list. */
export function buildIndexReview(context: BriefContext): Promise<BriefSectionResult> {
  const upcoming = nextIndexReview(context.request.asOf, context.calendar)

  return Promise.resolve(
    upcoming === undefined
      ? absent('index-review')
      : ready('index-review', [{ eventKind: upcoming.kind, at: upcoming.day }])
  )
}
