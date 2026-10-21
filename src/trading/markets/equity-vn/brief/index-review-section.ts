import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { VnBriefContext } from '@/trading/markets/equity-vn/brief/vn-context'
import { absent, ready } from '@/trading/markets/brief-sections'
import { nextIndexReview } from '@/trading/markets/equity-vn/index-review'

/** The next rebalance session, derived from the review rule rather than a maintained list. */
export function buildIndexReview(context: VnBriefContext): Promise<BriefSectionResult> {
  const upcoming = nextIndexReview(context.request.asOf, context.calendar)

  return Promise.resolve(
    upcoming === undefined
      ? absent('index-review')
      : ready('index-review', [{ eventKind: upcoming.kind, at: upcoming.day }])
  )
}
