import type { BriefTextWire } from '@/app/server/wire/brief'
import type { TocEntry } from '@/web/ui/reader/toc'
import { tr } from '@/web/text/tr'
import {
  blockAnchor,
  CAUTIONS_ANCHOR,
  sectionAnchor,
  sectionBlocks,
  sectionTitle,
  storyBlocks,
  VERDICT_ANCHOR,
} from '@/web/ui/reader/brief-model'

/** The brief's blocks and sections as contents entries, the cautions last. */
export function briefOutline(text: BriefTextWire): readonly TocEntry[] {
  return [
    ...storyBlocks(text.story).flatMap((block) =>
      block.title === undefined ? [] : [{ id: block.id, text: block.title, depth: 0 }]
    ),
    ...(text.verdictTitle === undefined
      ? []
      : [{ id: VERDICT_ANCHOR, text: text.verdictTitle, depth: 0 }]),
    ...sectionBlocks(text.sections).flatMap((block, index) => [
      ...(block.title === undefined
        ? []
        : [{ id: blockAnchor(index), text: block.title, depth: 0 }]),
      ...block.sections.map((section) => ({
        id: sectionAnchor(section),
        text: block.title === undefined ? sectionTitle(section) : section.heading,
        depth: block.title === undefined ? 0 : 1,
      })),
    ]),
    ...(text.caveats.length === 0
      ? []
      : [{ id: CAUTIONS_ANCHOR, text: tr('ui.office.reader.cautions'), depth: 0 }]),
  ]
}
