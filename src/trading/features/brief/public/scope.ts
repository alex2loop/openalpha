import type { BriefSectionKind, BriefSectionResult } from '@/trading/kernel/operator/brief-section'
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

/** The sections a brief must carry to be worth publishing. */
export const PUBLIC_CORE_SECTIONS = Object.freeze([
  'tape',
] as const satisfies readonly BriefSectionKind[])

/** The one section that states the session its market's roll-ups were measured at: the core section
 *  has no date of its own. */
export const PUBLIC_SESSION_KIND = 'market-prices' as const satisfies BriefSectionKind

/** The sections whose rows carry a story's code, which a later brief reviews. */
const CARRIED_STORY_KINDS: ReadonlySet<BriefSectionKind> = new Set(['story', 'thesis-review'])

export interface PublicToggles {
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

/** What an earlier public brief hands the story step: its stories, less any the toggles now omit.
 *  A story told while a group was on must not return as a review once the group is off. */
export function carriedSections(
  sections: readonly BriefSectionResult[],
  toggles: PublicToggles
): readonly BriefSectionResult[] {
  const omitted = publicStoryOmits(toggles)

  return sections.filter((section) => {
    if (section.status !== 'ready' || !CARRIED_STORY_KINDS.has(section.kind)) {
      return true
    }

    return ![...omitted].some((code) => code === section.rows[0]?.story)
  })
}
