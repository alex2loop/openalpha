/** The face text's font, in every face painter. */
export const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
/** The monospace the mockup's terminals are set in. */
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
const CLIP_MARK = '...'

interface LineStyle {
  readonly color: string
  readonly align?: CanvasTextAlign
  readonly weight?: number
  readonly maxW?: number
  /** Shrinks the text to fit `maxW` before cutting it. */
  readonly isFitted?: boolean
}

/** Text, x, y and font size in world px, then how it looks. */
type Line = readonly [string, number, number, number, LineStyle]

export function writeAll(c: CanvasRenderingContext2D, lines: readonly Line[]): void {
  for (const line of lines) {
    write(c, line)
  }
}

// Writes one line, shrunk when asked and cut with a trailing mark when it does not fit; returns
// the width it took.
export function write(c: CanvasRenderingContext2D, line: Line): number {
  const [raw, x, y, size, style] = line

  const { maxW, isFitted = false } = style

  c.font = fontOf(style, size)

  if (isFitted && maxW !== undefined) {
    c.font = fontOf(style, size * Math.min(1, maxW / c.measureText(raw).width))
  }

  c.fillStyle = style.color
  c.textAlign = style.align ?? 'left'

  const text = maxW === undefined || isFitted ? raw : clip(c, raw, maxW)

  c.fillText(text, x, y)

  return c.measureText(text).width
}

function fontOf(style: LineStyle, size: number): string {
  return `${style.weight ?? 500} ${size}px ${FONT}`
}

/** `text` as it fits in `maxW` px at the font set, cut with a trailing mark. */
export function clip(c: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (c.measureText(text).width <= maxW) {
    return text
  }

  let length = text.length

  while (length > 1 && c.measureText(`${text.slice(0, length)}${CLIP_MARK}`).width > maxW) {
    length--
  }

  return `${text.slice(0, length)}${CLIP_MARK}`
}
