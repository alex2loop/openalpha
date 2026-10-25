import type { ReportDoc } from '@/web/ui/markdown/parse'
import { pluralKey } from '@/i18n'
import { tr } from '@/web/text/tr'
import { jumpTo } from '@/web/ui/markdown/markdown'
import { SOURCES_ANCHOR } from '@/web/ui/reader/sources'

/** The report's headings, then its sources; each jumps there. It is hidden on a narrow screen. */
export function Toc({ doc }: { readonly doc: ReportDoc }) {
  const count = doc.sources.length

  if (doc.headings.length === 0 && count === 0) {
    return null
  }

  const topLevel = Math.min(...doc.headings.map((heading) => heading.level))

  return (
    <nav class="reader-toc" aria-label={tr('ui.office.reader.toc')}>
      <p class="reader-toc-head">{tr('ui.office.reader.toc')}</p>
      {doc.headings.map((heading) => (
        <button
          key={heading.id}
          type="button"
          class="reader-toc-item"
          style={`--depth:${heading.level - topLevel}`}
          onClick={() => jumpTo(heading.id)}
        >
          {heading.text}
        </button>
      ))}
      {count > 0 && (
        <button
          type="button"
          class="reader-toc-item is-sources"
          onClick={() => jumpTo(SOURCES_ANCHOR)}
        >
          {tr(pluralKey(count, 'ui.office.common.sourcesOne', 'ui.office.common.sources'), {
            count,
          })}
        </button>
      )}
    </nav>
  )
}
