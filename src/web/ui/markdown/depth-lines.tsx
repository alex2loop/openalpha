import { InlineMarkdown } from '@/web/ui/markdown/markdown'

// The daemon indents a level by two spaces.
const INDENT_WIDTH = 2

/** One line the daemon laid out, at the depth its leading spaces gave it. */
interface DepthLine {
  readonly text: string
  readonly depth: number
  readonly isMuted?: boolean
}

/** A line's own text and depth; `base` is the indent that reads as depth zero. */
export function toDepthLine(line: string, base = 0): DepthLine {
  return { text: line.trimStart(), depth: Math.max(0, (indentOf(line) - base) / INDENT_WIDTH) }
}

export function indentOf(line: string): number {
  return line.length - line.trimStart().length
}

/** Lines the daemon laid out for a fixed-width reader. Each is a block at its depth, so a line
 *  that wraps in a proportional font keeps its indent instead of falling back to the margin. */
export function DepthLines({ lines }: { readonly lines: readonly DepthLine[] }) {
  return (
    <div class="depth-lines">
      {lines.map((line, index) => (
        <p
          key={index}
          class={line.isMuted === true ? 'depth-line meta' : 'depth-line'}
          style={{ '--depth': line.depth }}
        >
          <InlineMarkdown text={line.text} />
        </p>
      ))}
    </div>
  )
}
