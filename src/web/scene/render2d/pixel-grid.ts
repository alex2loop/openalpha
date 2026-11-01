import { FIGURE } from '@/web/scene/types'

export const SPRITE_W = FIGURE.w
export const SPRITE_H = FIGURE.h

/** `x`, `y`, `w`, `h` in sprite pixels. */
type Box = readonly [x: number, y: number, w: number, h: number]

/** One sprite's pixels, row by row; `undefined` is clear. */
export type Cells<T> = (T | undefined)[]

export function createCells<T>(): Cells<T> {
  return new Array<T | undefined>(SPRITE_W * SPRITE_H).fill(undefined)
}

export function cellAt<T>(cells: Cells<T>, x: number, y: number): T | undefined {
  return x >= 0 && x < SPRITE_W && y >= 0 && y < SPRITE_H ? cells[y * SPRITE_W + x] : undefined
}

export function put<T>(cells: Cells<T>, at: readonly [x: number, y: number], value: T): void {
  const [x, y] = at

  if (x >= 0 && x < SPRITE_W && y >= 0 && y < SPRITE_H) {
    cells[y * SPRITE_W + x] = value
  }
}

export function rect<T>(cells: Cells<T>, box: Box, value: T): void {
  const [x, y, w, h] = box

  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      put(cells, [i, j], value)
    }
  }
}

/** A box with corners rounded by `r`. */
export function rounded<T>(
  cells: Cells<T>,
  shape: { readonly box: Box; readonly r: number },
  value: T
): void {
  const [x, y, w, h] = shape.box
  const { r } = shape

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const dx = Math.max(r - 0.5 - i, i - (w - 1 - (r - 0.5)), 0)
      const dy = Math.max(r - 0.5 - j, j - (h - 1 - (r - 0.5)), 0)

      if (dx * dx + dy * dy <= r * r) {
        put(cells, [x + i, y + j], value)
      }
    }
  }
}

export function ellipse<T>(
  cells: Cells<T>,
  shape: { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number },
  value: T
): void {
  const { cx, cy, rx, ry } = shape

  for (let j = Math.floor(cy - ry); j <= Math.ceil(cy + ry); j++) {
    for (let i = Math.floor(cx - rx); i <= Math.ceil(cx + rx); i++) {
      const a = (i - cx) / rx
      const b = (j - cy) / ry

      if (a * a + b * b <= 1) {
        put(cells, [i, j], value)
      }
    }
  }
}

/** Whether a clear pixel touches a filled one on any side: where the outline goes. */
export function isEdge<T>(cells: Cells<T>, x: number, y: number): boolean {
  return (
    cellAt(cells, x, y - 1) !== undefined ||
    cellAt(cells, x, y + 1) !== undefined ||
    cellAt(cells, x - 1, y) !== undefined ||
    cellAt(cells, x + 1, y) !== undefined
  )
}

/** Paints every filled pixel, one rectangle each. */
export function paintCells(g: CanvasRenderingContext2D, colours: Cells<string>): void {
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const colour = colours[y * SPRITE_W + x]

      if (colour !== undefined) {
        g.fillStyle = colour
        g.fillRect(x, y, 1, 1)
      }
    }
  }
}
