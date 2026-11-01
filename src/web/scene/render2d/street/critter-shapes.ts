import type { CritterView } from '@/web/scene/street-types'

/** A walk's stride at each of its four frames, in centimetres. */
export const STRIDE = [5, 0, -5, 0] as const

/** What an animal's picture is painted from: its sprite, the animal, the darkness, the detail
 *  level and its tones as night takes them. */
export interface Art {
  readonly g: CanvasRenderingContext2D
  readonly critter: CritterView
  readonly dark: number
  readonly detail: number
  readonly tone: (hex: string) => string
}

export function ellipse(
  g: CanvasRenderingContext2D,
  at: {
    readonly x: number
    readonly y: number
    readonly rx: number
    readonly ry: number
    readonly rot: number
    readonly tone: string
  }
): void {
  g.fillStyle = at.tone
  g.beginPath()
  g.ellipse(at.x, at.y, at.rx, at.ry, at.rot, 0, Math.PI * 2)
  g.fill()
}

export function line(
  g: CanvasRenderingContext2D,
  at: {
    readonly from: readonly [number, number]
    readonly to: readonly [number, number]
    readonly w: number
    readonly tone: string
  }
): void {
  g.strokeStyle = at.tone
  g.lineWidth = at.w
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(at.from[0], at.from[1])
  g.lineTo(at.to[0], at.to[1])
  g.stroke()
}

export function poly(g: CanvasRenderingContext2D, tone: string, points: readonly number[]): void {
  g.fillStyle = tone
  g.beginPath()
  g.moveTo(points[0] ?? 0, points[1] ?? 0)

  for (let index = 2; index < points.length; index += 2) {
    g.lineTo(points[index] ?? 0, points[index + 1] ?? 0)
  }

  g.closePath()
  g.fill()
}

/** A stroke through quadratic segments: a start point, then control and end pairs. */
export function curve(
  g: CanvasRenderingContext2D,
  at: { readonly points: readonly number[]; readonly w: number; readonly tone: string }
): void {
  const p = at.points

  g.strokeStyle = at.tone
  g.lineWidth = at.w
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.beginPath()
  g.moveTo(p[0] ?? 0, p[1] ?? 0)

  for (let index = 2; index + 3 < p.length; index += 4) {
    g.quadraticCurveTo(p[index] ?? 0, p[index + 1] ?? 0, p[index + 2] ?? 0, p[index + 3] ?? 0)
  }

  g.stroke()
}

/** An ellipse from `[x, y, rx, ry, rot]`. */
export function oval(
  g: CanvasRenderingContext2D,
  at: readonly [number, number, number, number, number?],
  tone: string
): void {
  ellipse(g, { x: at[0], y: at[1], rx: at[2], ry: at[3], rot: at[4] ?? 0, tone })
}
