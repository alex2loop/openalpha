import { FONT } from '@/web/scene/sprites/screens'

const LABEL_WEIGHT = 800

/** The width of `text` lettered at `size` world px. */
export function measureLabel(g: CanvasRenderingContext2D, text: string, size: number): number {
  g.font = fontOf(size)

  return g.measureText(text).width
}

/** One line of street lettering, centred on `x`, `y`, squeezed into `maxW` world px. */
export function paintLabel(
  g: CanvasRenderingContext2D,
  text: string,
  at: {
    readonly x: number
    readonly y: number
    readonly size: number
    readonly colour: string
    readonly maxW: number
  }
): void {
  g.font = fontOf(at.size)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = at.colour
  g.fillText(text, at.x, at.y, at.maxW)
}

function fontOf(size: number): string {
  return `${LABEL_WEIGHT} ${size}px ${FONT}`
}
