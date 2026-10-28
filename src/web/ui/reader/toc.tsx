import type { RefObject } from 'preact'
import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import { tr } from '@/web/text/tr'
import { jumpTo } from '@/web/ui/markdown/markdown'

/** The part of the page, measured from its top, where a heading counts as the one being read. */
const READING_BAND = '0px 0px -70% 0px'
const ID_SEPARATOR = ' '

export interface TocEntry {
  readonly id: string
  readonly text: string
  /** How far a sub-heading steps in under the one above it. */
  readonly depth: number
}

interface TocProps {
  readonly entries: readonly TocEntry[]
  /** The element the entries' headings scroll in. */
  readonly scroller: RefObject<HTMLElement | null>
}

/** The report's entries, one line each; the one being read is marked, and each jumps there. It is
 *  hidden on a narrow screen. */
export function Toc({ entries, scroller }: TocProps) {
  const ids = entries.map((entry) => entry.id).join(ID_SEPARATOR)
  const active = useActiveId(ids, scroller) ?? entries[0]?.id

  if (entries.length === 0) {
    return null
  }

  return (
    <nav class="reader-toc" aria-label={tr('ui.office.reader.toc')}>
      <p class="reader-toc-head">{tr('ui.office.reader.toc')}</p>
      {entries.map((entry) => (
        <button
          key={entry.id}
          type="button"
          class="reader-toc-item"
          style={`--depth:${entry.depth}`}
          title={entry.text}
          aria-current={entry.id === active ? 'location' : undefined}
          onClick={() => jumpTo(entry.id)}
        >
          {entry.text}
        </button>
      ))}
    </nav>
  )
}

// The first heading, in page order, inside the reading band; the observer is released with the page.
function useActiveId(ids: string, scroller: RefObject<HTMLElement | null>): string | undefined {
  const active = useSignal<string | undefined>(undefined)

  useEffect(() => {
    const root = scroller.current

    if (root === null) {
      return undefined
    }

    const order = ids.split(ID_SEPARATOR)
    const inBand = new Set<string>()
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          if (record.isIntersecting) {
            inBand.add(record.target.id)
          } else {
            inBand.delete(record.target.id)
          }
        }

        const first = order.find((id) => inBand.has(id))

        if (first !== undefined) {
          active.value = first
        }
      },
      { root, rootMargin: READING_BAND }
    )

    for (const id of order) {
      const heading = document.getElementById(id)

      if (heading !== null) {
        observer.observe(heading)
      }
    }

    return () => observer.disconnect()
  }, [ids, scroller, active])

  return active.value
}
