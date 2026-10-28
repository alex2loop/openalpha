import type { ReportDoc } from '@/web/ui/markdown/parse'
import type { TocEntry } from '@/web/ui/reader/toc'
import { pluralKey } from '@/i18n'
import { joinInline } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { SOURCES_ANCHOR } from '@/web/ui/reader/sources'

/** A report's headings, then its sources. A heading that another repeats takes the name of the one
 *  it sits under, or its place among the repeats when it sits under none. */
export function reportOutline(doc: ReportDoc): readonly TocEntry[] {
  const { headings } = doc
  const topLevel = Math.min(...headings.map((heading) => heading.level))
  const repeats = new Map<string, number>()
  const seen = new Map<string, number>()

  for (const heading of headings) {
    repeats.set(heading.text, (repeats.get(heading.text) ?? 0) + 1)
  }

  const entries = headings.map((heading, index) => {
    const nth = (seen.get(heading.text) ?? 0) + 1
    const parent = headings.slice(0, index).findLast((candidate) => candidate.level < heading.level)

    seen.set(heading.text, nth)

    return {
      id: heading.id,
      depth: heading.level - topLevel,
      text:
        (repeats.get(heading.text) ?? 0) < 2
          ? heading.text
          : joinInline([heading.text, parent?.text ?? `${nth}`]),
    }
  })
  const count = doc.sources.length

  return count === 0
    ? entries
    : [
        ...entries,
        {
          id: SOURCES_ANCHOR,
          depth: 0,
          text: tr(pluralKey(count, 'ui.office.common.sourcesOne', 'ui.office.common.sources'), {
            count,
          }),
        },
      ]
}
