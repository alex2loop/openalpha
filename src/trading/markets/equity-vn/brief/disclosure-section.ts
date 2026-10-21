import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { VnBriefContext } from '@/trading/markets/equity-vn/brief/vn-context'
import { absent, ready } from '@/trading/markets/brief-sections'
import { nextDisclosure } from '@/trading/markets/disclosure-calendar'

/** The whole market shares one reporting clock, so this is one row, not one per name. */
export function buildDisclosures(context: VnBriefContext): Promise<BriefSectionResult> {
  const upcoming = nextDisclosure(context.request.asOf)

  return Promise.resolve(
    upcoming === undefined
      ? absent('disclosures')
      : ready('disclosures', [{ eventKind: upcoming.kind, at: upcoming.dueBy }])
  )
}
