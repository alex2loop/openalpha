import type { Rect, StreetFrame } from '@/web/scene/types'
import { STREET_RECT } from '@/web/scene/view'

/** Draws the street behind the floor, under `g`'s world transform: the static canvas, then the
 *  moving one over its rect, each only where it meets the pane. */
export function blitStreet(g: CanvasRenderingContext2D, frame: StreetFrame): void {
  const { a, d, e, f } = g.getTransform()
  const seen: Rect = { x: -e / a, y: -f / d, w: g.canvas.width / a, h: g.canvas.height / d }

  g.imageSmoothingEnabled = true
  blitPart(g, { canvas: frame.staticCanvas, rect: STREET_RECT, seen })
  blitPart(g, { canvas: frame.movingCanvas, rect: frame.movingRect, seen })
}

// The part of `canvas` (painted over `rect`, in world px) that lies within `seen`.
function blitPart(
  g: CanvasRenderingContext2D,
  part: { readonly canvas: HTMLCanvasElement; readonly rect: Rect; readonly seen: Rect }
): void {
  const { canvas, rect, seen } = part
  const x0 = Math.max(rect.x, seen.x)
  const y0 = Math.max(rect.y, seen.y)
  const x1 = Math.min(rect.x + rect.w, seen.x + seen.w)
  const y1 = Math.min(rect.y + rect.h, seen.y + seen.h)

  if (canvas.width === 0 || rect.w <= 0 || x1 <= x0 || y1 <= y0) {
    return
  }

  const px = canvas.width / rect.w
  const py = canvas.height / rect.h

  g.drawImage(
    canvas,
    (x0 - rect.x) * px,
    (y0 - rect.y) * py,
    (x1 - x0) * px,
    (y1 - y0) * py,
    x0,
    y0,
    x1 - x0,
    y1 - y0
  )
}
