/** The face text's font, in every face painter. */
export const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const CLIP_MARK = '...'

interface LineStyle {
  readonly color: string
  readonly align?: CanvasTextAlign
  readonly weight?: number
  readonly maxW?: number
}

/** Text, x, y and font size in world px, then how it looks. */
type Line = readonly [string, number, number, number, LineStyle]

export function writeAll(c: CanvasRenderingContext2D, lines: readonly Line[]): void {
  for (const line of lines) {
    write(c, line)
  }
}

// Writes one line, cut with a trailing mark when it does not fit; returns the width it took.
export function write(c: CanvasRenderingContext2D, line: Line): number {
  const [raw, x, y, size, style] = line

  c.font = `${style.weight ?? 500} ${size}px ${FONT}`
  c.fillStyle = style.color
  c.textAlign = style.align ?? 'left'

  const text = style.maxW === undefined ? raw : clip(c, raw, style.maxW)

  c.fillText(text, x, y)

  return c.measureText(text).width
}

function clip(c: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (c.measureText(text).width <= maxW) {
    return text
  }

  let length = text.length

  while (length > 1 && c.measureText(`${text.slice(0, length)}${CLIP_MARK}`).width > maxW) {
    length--
  }

  return `${text.slice(0, length)}${CLIP_MARK}`
}
