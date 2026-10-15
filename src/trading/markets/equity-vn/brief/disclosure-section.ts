import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/equity-vn/brief/context'
import { nextDisclosure } from '@/trading/markets/disclosure-calendar'
import { absent, ready } from '@/trading/markets/equity-vn/brief/sections'

/** The whole market shares one reporting clock, so this is one row, not one per name. */
export function buildDisclosures(context: BriefContext): Promise<BriefSectionResult> {
  const upcoming = nextDisclosure(context.request.asOf)

  return Promise.resolve(
    upcoming === undefined
      ? absent('disclosures')
      : ready('disclosures', [{ eventKind: upcoming.kind, at: upcoming.dueBy }])
  )
}
