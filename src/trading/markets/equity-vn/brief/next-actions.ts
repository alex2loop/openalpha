import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { VnBriefContext } from '@/trading/markets/equity-vn/brief/vn-context'
import { sectionNumber } from '@/trading/kernel/operator/brief-section'
import { buildNextActions } from '@/trading/markets/brief-next-actions'
import { VN_STORY_POLICY } from '@/trading/markets/equity-vn/brief/story-policy'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { CONFIRMING_TURNOVER_RATIO } from '@/trading/markets/overview-sections'

export function buildVnNextActions(
  context: VnBriefContext,
  sections: readonly BriefSectionResult[],
  overviews: readonly BriefSectionResult[]
): Promise<BriefSectionResult> {
  return buildNextActions(
    context,
    sections,
    isCrowdedTop(sections, overviews) ? ['avoid-chasing'] : []
  )
}

/** Near resistance on thin turnover, a buy pays up for the level rather than to reach it. "Near" is
 *  the story's own reading of a level test, so the action and the story never disagree. The
 *  tape row comes from the handed builder sections; the range lives only on the overview read,
 *  which the composer already holds — neither is fetched twice. */
function isCrowdedTop(
  sections: readonly BriefSectionResult[],
  overviews: readonly BriefSectionResult[]
): boolean {
  const vnRange = overviews.find(
    (section) => section.kind === 'range' && section.market === VN_MARKET_REF
  )
  const resistancePct =
    vnRange === undefined ? undefined : sectionNumber([vnRange], 'range', 'resistancePct')
  const turnoverRatio = sectionNumber(sections, 'tape', 'turnoverRatio')

  return (
    resistancePct !== undefined &&
    resistancePct <= VN_STORY_POLICY.levelNear &&
    turnoverRatio !== undefined &&
    turnoverRatio < CONFIRMING_TURNOVER_RATIO
  )
}
