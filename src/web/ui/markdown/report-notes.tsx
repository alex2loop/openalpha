import { Fold } from '@/web/ui/kit/fold'
import { InlineMarkdown } from '@/web/ui/markdown/markdown'

// The daemon marks a fold as a bold title line followed by quoted lines.
const FOLD_TITLE = /^\*\*(.+)\*\*$/
const QUOTE_MARK = /^>\s?/

type Segment =
  | { readonly kind: 'lines'; readonly lines: string[] }
  | { readonly kind: 'fold'; readonly title: string; readonly lines: string[] }

/** The daemon's note lines under a report: plain lines as one compact list, each folded group
 *  (a bold title, then quoted lines) behind its title. The words are the daemon's own. */
export function ReportNotes({ lines }: { readonly lines: readonly string[] }) {
  return (
    <>
      {segmentsOf(lines).map((segment, index) =>
        segment.kind === 'fold' ? (
          <Fold key={index} title={segment.title}>
            <NoteList lines={segment.lines} />
          </Fold>
        ) : (
          <NoteList key={index} lines={segment.lines} />
        )
      )}
    </>
  )
}

function NoteList({ lines }: { readonly lines: readonly string[] }) {
  return (
    <ul class="meta note-list">
      {lines.map((line) => (
        <li key={line}>
          <InlineMarkdown text={line} />
        </li>
      ))}
    </ul>
  )
}

function segmentsOf(lines: readonly string[]): readonly Segment[] {
  const segments: Segment[] = []

  for (const line of lines) {
    const title = FOLD_TITLE.exec(line)?.[1]
    const last = segments.at(-1)

    if (title !== undefined) {
      segments.push({ kind: 'fold', title, lines: [] })
    } else if (last?.kind === 'fold' && QUOTE_MARK.test(line)) {
      last.lines.push(line.replace(QUOTE_MARK, ''))
    } else if (last?.kind === 'lines') {
      last.lines.push(line)
    } else {
      segments.push({ kind: 'lines', lines: [line] })
    }
  }

  return segments
}
