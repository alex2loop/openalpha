import type { PublicBriefRow, PublicToggles } from '@/trading/features/brief/public/types'
import type {
  BriefField,
  BriefSectionKind,
  BriefSectionResult,
  BriefSectionRow,
} from '@/trading/kernel/operator/brief-section'
import type { StoryCode } from '@/trading/kernel/operator/brief-story'
import { isSectionShown } from '@/trading/features/brief/render'
import { BRIEF_SECTION_ORDER } from '@/trading/kernel/operator/brief-section'
import { BRIEF_SECTION_SCOPE } from '@/trading/kernel/operator/brief-section-scope'
import { DIRECTIONAL_STORY_CODES } from '@/trading/kernel/operator/brief-story'

export const PUBLIC_ANALYSIS_KINDS = Object.freeze([
  'macro',
  'regime-shift',
  'sector-rotation',
  'range',
  'basis',
  'screen-delta',
] as const satisfies readonly BriefSectionKind[])

export const PUBLIC_HEADLINE_KINDS = Object.freeze([
  'headlines',
  'macro-headlines',
  'economy-headlines',
] as const satisfies readonly BriefSectionKind[])

/** Fields the public brief never carries: a sector's over/underweight reads as advice, and the
 *  strength beside it already says which way it leans. */
export const PUBLIC_DROPPED_FIELDS: Readonly<
  Partial<Record<BriefSectionKind, readonly BriefField[]>>
> = Object.freeze({ 'sector-rotation': ['direction'] })

/** The sections a brief must carry to be worth publishing. */
export const PUBLIC_CORE_SECTIONS = Object.freeze([
  'tape',
] as const satisfies readonly BriefSectionKind[])

/** The one section that states the session its market's roll-ups were measured at: the core section
 *  has no date of its own. */
export const PUBLIC_SESSION_KIND = 'market-prices' as const satisfies BriefSectionKind

/** An uppercase symbol inside a headline: capitals and digits, joined by `.`, `_` or `-`, with no
 *  letter or digit beside it. */
const HEADLINE_TOKEN_RE = /(?<![A-Za-z0-9])[A-Z0-9]+(?:[._-][A-Z0-9]+)*(?![A-Za-z0-9])/g
const HEADLINE_JOINER_RE = /[._-]/
const LETTER_RE = /[A-Z]/

/** The sections whose rows carry a story's code, which a later brief reviews. */
const CARRIED_STORY_KINDS: ReadonlySet<BriefSectionKind> = new Set(['story', 'thesis-review'])

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

/** The stories passed as `omitStories`: none, or the directional stories when the analysis group is
 *  off. */
export function publicStoryOmits(toggles: PublicToggles): ReadonlySet<StoryCode> {
  return new Set(toggles.analysis ? [] : DIRECTIONAL_STORY_CODES)
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

/** The tickers this brief may name: the `ticker` of every row of a `market` section the renderer
 *  prints, the uppercase symbols of a headline row's own title, and the names on its screen lists.
 *  Read from structured rows alone, never from rendered text, and from printed `market` kinds
 *  alone: a book kind, or a stored kind the renderer leaves out, adds nothing. */
export function exemptTickers(row: PublicBriefRow): ReadonlySet<string> {
  return new Set([
    ...(row.sections ?? []).flatMap(sectionTickers),
    ...(row.screens ?? []).flatMap((screen) =>
      Object.values(screen.rows).flatMap((rows) => rows.map((screenRow) => screenRow.ticker))
    ),
  ])
}

function sectionTickers(section: BriefSectionResult): readonly string[] {
  if (
    section.status !== 'ready' ||
    BRIEF_SECTION_SCOPE[section.kind] !== 'market' ||
    !isSectionShown(section)
  ) {
    return []
  }

  const isHeadline = PUBLIC_HEADLINE_KINDS.some((kind) => kind === section.kind)

  return section.rows.flatMap((row) => rowTickers(row, isHeadline))
}

function rowTickers(row: BriefSectionRow, isHeadline: boolean): readonly string[] {
  const named = typeof row.ticker === 'string' ? [row.ticker] : []

  return isHeadline && typeof row.title === 'string'
    ? [...named, ...headlineSymbols(row.title)]
    : named
}

/** Each symbol of a title and its parts, so the base of `BTC-USD` is named too. A part with no
 *  letter is a number, not a name. */
function headlineSymbols(title: string): readonly string[] {
  return (title.match(HEADLINE_TOKEN_RE) ?? [])
    .flatMap((token) => [token, ...token.split(HEADLINE_JOINER_RE)])
    .filter((part) => LETTER_RE.test(part))
}
