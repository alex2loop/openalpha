import { InlineText, type TextRenderer } from '@/web/ui/markdown/inline-view'

import './markdown.css'

interface NoteListProps {
  readonly lines: readonly string[]
  readonly renderText?: TextRenderer | undefined
}

/** Short daemon lines as one compact list. */
export function NoteList({ lines, renderText }: NoteListProps) {
  if (lines.length === 0) {
    return null
  }

  return (
    <ul class="stack meta note-list">
      {lines.map((line) => (
        <li key={line}>
          <InlineText text={line} renderText={renderText} />
        </li>
      ))}
    </ul>
  )
}
