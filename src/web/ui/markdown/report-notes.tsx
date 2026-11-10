import { isNoteLine, withoutLeadingIcon } from '@/web/text/glyphs'
import { useUnstripped } from '@/web/ui/kit/cautions'
import { Fold } from '@/web/ui/kit/fold'
import { NoteList } from '@/web/ui/markdown/note-list'
import { renderLinkedText } from '@/web/ui/ticker/linked-text'

// The daemon marks a fold as a bold title line followed by quoted lines.
const FOLD_TITLE = /^\*\*(.+)\*\*$/
const QUOTE_MARK = /^>\s?/

type Segment =
  | { readonly kind: 'lines'; readonly lines: string[] }
  | { readonly kind: 'fold'; readonly title: string; readonly lines: string[] }

/** The daemon's note lines under a report: plain lines as one compact list, the cautions among
 *  them as another, each folded group (a bold title, then quoted lines) behind its title. The
 *  words are the daemon's own; a caution the block's strip already shows is left out. */
export function ReportNotes({ lines }: { readonly lines: readonly string[] }) {
  const shown = useUnstripped(lines)

  return (
    <>
      {segmentsOf(shown).map((segment, index) =>
        segment.kind === 'fold' ? (
          <Fold key={index} title={withoutLeadingIcon(segment.title)}>
            <NoteList lines={segment.lines} renderText={renderLinkedText} />
          </Fold>
        ) : (
          <SplitNotes key={index} lines={segment.lines} />
        )
      )}
    </>
  )
}

function SplitNotes({ lines }: { readonly lines: readonly string[] }) {
  return (
    <>
      <NoteList lines={lines.filter((line) => !isNoteLine(line))} renderText={renderLinkedText} />
      <NoteList lines={lines.filter(isNoteLine)} renderText={renderLinkedText} />
    </>
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
