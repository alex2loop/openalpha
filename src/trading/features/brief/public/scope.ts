import type { BriefSectionKind } from '@/trading/kernel/operator/brief-section'
import type { StoryCode } from '@/trading/kernel/operator/brief-story'
import { BRIEF_SECTION_ORDER } from '@/trading/kernel/operator/brief-section'
import { BRIEF_SECTION_SCOPE } from '@/trading/kernel/operator/brief-section-scope'

export const PUBLIC_ANALYSIS_KINDS = Object.freeze([
  'macro',
  'regime-shift',
  'sector-rotation',
  'range',
  'basis',
  'screen-delta',
] as const satisfies readonly BriefSectionKind[])

export const PUBLIC_ANALYSIS_STORIES = Object.freeze([
  'support-test',
  'resistance-test',
  'sector-leading',
  'sector-lagging',
  'basis-premium',
  'basis-discount',
] as const satisfies readonly StoryCode[])

export const PUBLIC_HEADLINE_KINDS = Object.freeze([
  'headlines',
  'macro-headlines',
  'economy-headlines',
] as const satisfies readonly BriefSectionKind[])

interface PublicToggles {
  readonly analysis: boolean
  readonly headlines: boolean
}

/** Every `market` kind the toggles leave on. The one classification read is `BRIEF_SECTION_SCOPE`:
 *  a kind it scopes `book` is never published, whatever a group says. */
export function publicSectionKinds(toggles: PublicToggles): ReadonlySet<BriefSectionKind> {
  const pulled = new Set<BriefSectionKind>([
    ...(toggles.analysis ? [] : PUBLIC_ANALYSIS_KINDS),
    ...(toggles.headlines ? [] : PUBLIC_HEADLINE_KINDS),
  ])

  return new Set(
    BRIEF_SECTION_ORDER.filter(
      (kind) => BRIEF_SECTION_SCOPE[kind] === 'market' && !pulled.has(kind)
    )
  )
}

/** The stories passed as `omitStories`: none, or the analysis stories when that group is off. */
export function publicStoryOmits(toggles: PublicToggles): ReadonlySet<StoryCode> {
  return new Set(toggles.analysis ? [] : PUBLIC_ANALYSIS_STORIES)
}
