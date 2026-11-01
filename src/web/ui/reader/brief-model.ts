import type { BriefTextWire } from '@/app/server/wire/brief'
import type { TocEntry } from '@/web/ui/reader/toc'
import { isInfoLine, isNoteLine, joinInline, withoutLeadingIcon } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

type BriefSection = BriefTextWire['sections'][number]
export type StoryLine = BriefTextWire['story'][number]

export const CAUTIONS_ANCHOR = 'brief-cautions'
const STORY_ANCHOR_PREFIX = 'brief-story-'
const SECTION_ANCHOR_PREFIX = 'brief-section-'

type StoryPart =
  | { readonly kind: 'lead'; readonly text: string }
  | { readonly kind: 'lines'; readonly heading: string | undefined; readonly lines: StoryLine[] }

export interface StoryBlock {
  readonly id: string
  readonly title: string | undefined
  readonly parts: StoryPart[]
}

/** The story's lines as blocks: each title opens one, each heading a group of the figures and notes
 *  under it. */
export function storyBlocks(story: BriefTextWire['story']): readonly StoryBlock[] {
  const blocks: StoryBlock[] = []
  let block: StoryBlock | undefined

  for (const line of story) {
    if (line.role === 'title' || block === undefined) {
      block = {
        id: `${STORY_ANCHOR_PREFIX}${blocks.length}`,
        title: line.role === 'title' ? line.text : undefined,
        parts: [],
      }
      blocks.push(block)
    }

    if (line.role !== 'title') {
      addLine(block.parts, line)
    }
  }

  return blocks
}

function addLine(parts: StoryPart[], line: StoryLine): void {
  const last = parts.at(-1)

  if (line.role === 'lead') {
    parts.push({ kind: 'lead', text: line.text })
  } else if (line.role === 'heading') {
    parts.push({ kind: 'lines', heading: line.text, lines: [] })
  } else if (last?.kind === 'lines') {
    last.lines.push(line)
  } else {
    parts.push({ kind: 'lines', heading: undefined, lines: [line] })
  }
}

export interface SectionRow {
  readonly text: string
  /** What sits under the row: a price board's figures under the name they belong to. */
  readonly details: readonly string[]
}

/** A section's lines as rows: each line at depth 0 opens one and the deeper lines after it are its
 *  details. A line before any row, or from a daemon that sends no depths, is a row of its own. */
export function sectionRows(section: BriefSection): readonly SectionRow[] {
  const rows: { readonly text: string; readonly details: string[] }[] = []

  section.lines.forEach((text, index) => {
    const last = rows.at(-1)

    if ((section.depths?.[index] ?? 0) > 0 && last !== undefined) {
      last.details.push(text)
    } else {
      rows.push({ text, details: [] })
    }
  })

  return rows
}

/** A section's name; one that belongs to a market says which, as the same heading repeats per market. */
export function sectionTitle(section: BriefSection): string {
  return section.market === undefined
    ? section.heading
    : joinInline([section.heading, section.market])
}

export function sectionAnchor(section: BriefSection): string {
  return `${SECTION_ANCHOR_PREFIX}${section.id}`
}

interface Cautions {
  readonly warnings: readonly string[]
  /** The by-design notes: the daemon's title for them, then each note. */
  readonly methodology: { readonly title: string; readonly lines: readonly string[] } | undefined
}

/** The caveats as the CLI words them: each caution leads with its icon; the by-design notes are an
 *  info line followed by the lines under it. */
export function groupCautions(caveats: readonly string[]): Cautions {
  const warnings: string[] = []
  const notes: string[] = []
  let title: string | undefined

  for (const line of caveats) {
    if (isInfoLine(line)) {
      title = withoutLeadingIcon(line)
    } else if (title === undefined || isNoteLine(line)) {
      warnings.push(withoutLeadingIcon(line))
    } else {
      notes.push(line.trim())
    }
  }

  return { warnings, methodology: title === undefined ? undefined : { title, lines: notes } }
}

/** The brief's blocks and sections as contents entries, the cautions last. */
export function briefOutline(text: BriefTextWire): readonly TocEntry[] {
  return [
    ...storyBlocks(text.story).flatMap((block) =>
      block.title === undefined ? [] : [{ id: block.id, text: block.title, depth: 0 }]
    ),
    ...text.sections.map((section) => ({
      id: sectionAnchor(section),
      text: sectionTitle(section),
      depth: 0,
    })),
    ...(text.caveats.length === 0
      ? []
      : [{ id: CAUTIONS_ANCHOR, text: tr('ui.office.reader.cautions'), depth: 0 }]),
  ]
}
