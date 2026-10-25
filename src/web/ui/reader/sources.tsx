import type { ReportSource } from '@/web/ui/markdown/parse'
import { tr } from '@/web/text/tr'
import { sourceAnchor } from '@/web/ui/markdown/parse'

/** Where the table of contents' last entry lands. */
export const SOURCES_ANCHOR = 'rsrc'

interface SourcesProps {
  readonly sources: readonly ReportSource[]
  /** The sources carry ids, so a footnote can jump to them. */
  readonly isAnchored: boolean
}

/** The numbered sources a report names; a source with an address links out. */
export function Sources({ sources, isAnchored }: SourcesProps) {
  if (sources.length === 0) {
    return null
  }

  return (
    <section class="md-sources">
      <h3 class="md-heading" id={isAnchored ? SOURCES_ANCHOR : undefined} tabIndex={-1}>
        {tr('trading.render.suggestion.sources')}
      </h3>
      <ol class="md-list">
        {sources.map((source) => (
          <li
            key={source.n}
            id={isAnchored ? sourceAnchor(source.n) : undefined}
            value={source.n}
            tabIndex={-1}
          >
            {source.url === undefined ? (
              source.text
            ) : (
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.text}
              </a>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
