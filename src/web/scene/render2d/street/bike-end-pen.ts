import type { BikeArt } from '@/web/scene/render2d/street/bike-model'
import { CM_ALONG, CM_UP, dot, line, poly } from '@/web/scene/render2d/street/bike-model'

/** A point on the machine end on: across it (`z`), forward along it (`f`) and up (`h`), in cm. */
export type Cm = readonly [number, number, number]

/** An end view: the model art and which way the bike faces (1 toward the viewer). */
export interface EndArt extends BikeArt {
  readonly dir: 1 | -1
}

export function toPx(art: EndArt, at: Cm): readonly [number, number] {
  return [at[0] * CM_ALONG, art.dir * at[1] * CM_ALONG - at[2] * CM_UP]
}

// A flat panel facing the viewer: across from `z0` to `z1` at `f`, up from `h0` to `h1`.
export function card(
  art: EndArt,
  at: readonly [number, number, number, number, number],
  colour: string
): void {
  const [x0, y0] = toPx(art, [at[0], at[2], at[4]])
  const [x1, y1] = toPx(art, [at[1], at[2], at[3]])

  art.g.fillStyle = colour
  art.g.fillRect(x0, y0, x1 - x0, y1 - y0)
}

/** A stroke between two points, `at` holding both points' `z`, `f`, `h` in turn. */
export function seg(
  art: EndArt,
  at: readonly number[],
  pen: { readonly w: number; readonly c: string }
): void {
  const [x0, y0] = toPx(art, cmAt(at, 0))
  const [x1, y1] = toPx(art, cmAt(at, 1))

  line(art.g, [x0, y0, x1, y1], { w: pen.w * CM_ALONG, c: pen.c })
}

export function spot(art: EndArt, at: readonly [Cm, number, number], colour: string): void {
  const [x, y] = toPx(art, at[0])

  dot(art.g, [x, y, at[1] * CM_ALONG, at[2] * CM_ALONG], colour)
}

/** A filled four-sided shape, `at` holding its four points' `z`, `f`, `h` in turn. */
export function quad(art: EndArt, at: readonly number[], colour: string): void {
  poly(
    art.g,
    [0, 1, 2, 3].flatMap((index) => toPx(art, cmAt(at, index))),
    colour
  )
}

function cmAt(at: readonly number[], index: number): Cm {
  return [at[index * 3] ?? 0, at[index * 3 + 1] ?? 0, at[index * 3 + 2] ?? 0]
}
