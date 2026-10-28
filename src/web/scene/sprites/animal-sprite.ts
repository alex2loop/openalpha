import type { AnimalMotion } from '@/web/scene/sim/life/animal-motion'
import type { AnimalKind, AnimalPart, Ellipsoid } from '@/web/scene/sprites/animal-parts'
import { partTurnOf } from '@/web/scene/sim/life/animal-motion'
import { animalShape } from '@/web/scene/sprites/animal-shapes'
import { createSpriteCache } from '@/web/scene/sprites/sprite-cache'

/** World px per model cm. */
export const ANIMAL_UNIT = 0.2
// Sprite px per world px at each detail level.
const LEVEL_RES = [1, 2, 4] as const
// Sprites kept at most; past it the least recently drawn goes.
const MAX_SPRITES = 640
const PAD_PX = 2
// A pixel at least this opaque is solid; the rest is clear, then outlined.
const SOLID_ALPHA = 120
const OPAQUE = 255
const OUTLINE_RGB = [43, 36, 51] as const
const LIT = '#FFFFFF'
const SHADE = '#2B2433'
const FAR_SHADE = '#3A3045'
const DIM_TONE = '#26343F'
const RING_STEPS = 24
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const

type Mat = readonly number[]
type Vec3 = readonly [number, number, number]

/** One rasterised animal: its canvas, its px per world px, and where the model's origin sits. */
interface AnimalSprite {
  readonly canvas: HTMLCanvasElement
  readonly res: number
  readonly ox: number
  readonly oy: number
}

// One ellipsoid placed in the world and projected: screen y is depth minus height.
interface Placed {
  readonly q: Ellipsoid
  readonly rw: Mat
  readonly cw: Vec3
  readonly cx: number
  readonly cy: number
  readonly a: number
  readonly b: number
  readonly d: number
  readonly sc: readonly (readonly [number, number])[]
}

const sprites = createSpriteCache<AnimalSprite>({
  max: MAX_SPRITES,
  canvasOf: (sprite) => sprite.canvas,
})

/** The sprite of `kind` in `pose` at detail `level`, moved as `motion`, dimmed in an unlit tank;
 *  built once and cached; absent while a frame has no time left to build it. */
export function animalSprite(spec: {
  readonly kind: AnimalKind
  readonly pose: string
  readonly level: number
  readonly motion: AnimalMotion
  readonly isDim: boolean
}): AnimalSprite | undefined {
  const { kind, pose, level, motion } = spec
  const key = `${kind}|${pose}|${level}|${Object.values(motion).join(',')}|${spec.isDim}`

  return sprites.obtain(key, () => {
    const placed = placeParts(animalShape(kind, pose, level), (name) =>
      partTurnOf(kind, name, motion)
    )

    return raster(placed, { res: LEVEL_RES[level] ?? 1, isDim: spec.isDim })
  })
}

/** Zeroes and drops every cached animal sprite. */
export function releaseAnimalSprites(): void {
  sprites.clear()
}

/** Draws `sprite` with its model origin at world (`x`, `y`), mirrored when `isFlipped`; nothing
 *  for a sprite not built yet. */
export function blitAnimal(
  g: CanvasRenderingContext2D,
  sprite: AnimalSprite | undefined,
  at: { readonly x: number; readonly y: number; readonly isFlipped: boolean }
): void {
  if (sprite === undefined) {
    return
  }

  const w = sprite.canvas.width / sprite.res
  const h = sprite.canvas.height / sprite.res
  const left = at.isFlipped ? at.x + sprite.ox / sprite.res - w : at.x - sprite.ox / sprite.res

  if (at.isFlipped) {
    g.save()
    g.translate(left * 2 + w, 0)
    g.scale(-1, 1)
    g.drawImage(sprite.canvas, left, at.y - sprite.oy / sprite.res, w, h)
    g.restore()
    return
  }

  g.drawImage(sprite.canvas, left, at.y - sprite.oy / sprite.res, w, h)
}

function placeParts(
  parts: readonly AnimalPart[],
  turn: (name: string) => { readonly az: number; readonly ay: number; readonly sy: number }
): Placed[] {
  const world = new Map<string, { readonly l: Mat; readonly t: Vec3 }>()
  const out: Placed[] = []

  for (const p of parts) {
    const x = turn(p.name)
    const parent = (p.parent === undefined ? undefined : world.get(p.parent)) ?? {
      l: IDENTITY,
      t: [0, 0, 0] as const,
    }
    const l = mul(parent.l, mul(rot(p.A[0] + x.az, p.A[1] + x.ay), [1, 0, 0, 0, x.sy, 0, 0, 0, 1]))
    const o = apply(parent.l, p.T)
    const t: Vec3 = [o[0] + parent.t[0], o[1] + parent.t[1], o[2] + parent.t[2]]

    world.set(p.name, { l, t })

    for (const q of p.prims) {
      out.push(project(q, { l, t }))
    }
  }

  return out
}

function project(q: Ellipsoid, at: { readonly l: Mat; readonly t: Vec3 }): Placed {
  const rw = mul(at.l, rot(q.a[0], q.a[1]))
  const c = apply(at.l, q.c)
  const cw: Vec3 = [c[0] + at.t[0], c[1] + at.t[1], c[2] + at.t[2]]
  const sc = [0, 1, 2].map((i) => {
    const r = q.r[i] ?? 0
    const v = [(rw[i] ?? 0) * r, (rw[3 + i] ?? 0) * r, (rw[6 + i] ?? 0) * r]

    return [v[0] ?? 0, (v[2] ?? 0) - (v[1] ?? 0)] as const
  })
  let a = 0
  let b = 0
  let d = 0

  for (const [u, v] of sc) {
    a += u * u
    b += u * v
    d += v * v
  }

  return { q, rw, cw, cx: cw[0], cy: cw[2] - cw[1], a, b, d, sc }
}

// Far side first, each ellipse lit from above, the tabby rings over it, then every pixel made
// solid and given a one-pixel outline.
function raster(
  placed: readonly Placed[],
  look: { readonly res: number; readonly isDim: boolean }
): AnimalSprite {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY

  for (const o of placed) {
    x0 = Math.min(x0, o.cx - Math.sqrt(o.a))
    x1 = Math.max(x1, o.cx + Math.sqrt(o.a))
    y0 = Math.min(y0, o.cy - Math.sqrt(o.d))
    y1 = Math.max(y1, o.cy + Math.sqrt(o.d))
  }

  const k = ANIMAL_UNIT * look.res
  const canvas = document.createElement('canvas')

  canvas.width = Math.ceil((x1 - x0) * k) + PAD_PX * 2
  canvas.height = Math.ceil((y1 - y0) * k) + PAD_PX * 2

  const c = canvas.getContext('2d', { willReadFrequently: true })
  const sprite = { canvas, res: look.res, ox: PAD_PX - x0 * k, oy: PAD_PX - y0 * k }

  if (c === null) {
    return sprite
  }

  c.setTransform(k, 0, 0, k, sprite.ox, sprite.oy)
  paintEllipsoids(c, placed, look.isDim)
  solidify(c, canvas)

  return sprite
}

function paintEllipsoids(
  c: CanvasRenderingContext2D,
  placed: readonly Placed[],
  isDim: boolean
): void {
  const tint = (hex: string): string => (isDim ? mix(hex, DIM_TONE, 0.5) : hex)
  const order = placed
    .map((o, i) => ({ o, i }))
    .sort((p, q) => Math.round(p.o.cw[2] / 3) - Math.round(q.o.cw[2] / 3) || p.i - q.i)

  for (const { o } of order) {
    const base = tint(o.cw[2] < -2 ? mix(o.q.k, FAR_SHADE, 0.14) : o.q.k)
    const hy = Math.sqrt(o.d)
    const gradient = c.createLinearGradient(0, o.cy - hy, 0, o.cy + hy)

    gradient.addColorStop(0, mix(base, LIT, 0.14))
    gradient.addColorStop(0.55, base)
    gradient.addColorStop(1, mix(base, SHADE, 0.2))
    c.fillStyle = gradient
    ellipsePath(c, o)
    c.fill()

    if (o.q.band !== undefined) {
      c.save()
      ellipsePath(c, o)
      c.clip()

      for (const band of o.q.band) {
        ring(c, o, [band[0], band[1], tint(band[2])])
      }

      c.restore()
    }
  }
}

function ellipsePath(c: CanvasRenderingContext2D, o: Placed): void {
  const m = (o.a + o.d) / 2
  const s = Math.sqrt(((o.a - o.d) / 2) ** 2 + o.b * o.b)

  c.beginPath()
  c.ellipse(
    o.cx,
    o.cy,
    Math.sqrt(Math.max(0.01, m + s)),
    Math.sqrt(Math.max(0.01, m - s)),
    0.5 * Math.atan2(2 * o.b, o.a - o.d),
    0,
    Math.PI * 2
  )
}

// A stripe round the ellipsoid at its x band, drawn where it faces the viewer.
function ring(
  c: CanvasRenderingContext2D,
  o: Placed,
  band: readonly [number, number, string]
): void {
  const { q, rw, cw } = o
  const xn = (band[0] + band[1]) / 2
  const s = Math.sqrt(1 - xn * xn)
  const pts = Array.from({ length: RING_STEPS + 1 }, (_, i) => {
    const f = (i / RING_STEPS) * Math.PI * 2
    const p = apply(rw, [xn * q.r[0], s * q.r[1] * Math.cos(f), s * q.r[2] * Math.sin(f)])
    const n = apply(rw, [xn / q.r[0], (s * Math.cos(f)) / q.r[1], (s * Math.sin(f)) / q.r[2]])

    return { x: cw[0] + p[0], y: cw[2] + p[2] - cw[1] - p[1], isSeen: n[1] + n[2] > -0.02 }
  })
  const first = o.sc[0] ?? [0, 0]

  c.strokeStyle = band[2]
  c.lineCap = 'round'
  c.lineWidth = Math.max(0.6, (band[1] - band[0]) * Math.hypot(first[0], first[1]))
  c.beginPath()

  for (let i = 0; i < RING_STEPS; i++) {
    const a = pts[i]
    const b = pts[i + 1]

    if (a?.isSeen === true && b?.isSeen === true) {
      c.moveTo(a.x, a.y)
      c.lineTo(b.x, b.y)
    }
  }

  c.stroke()
}

function solidify(c: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  const { width: w, height: h } = canvas
  const image = c.getImageData(0, 0, w, h)
  const px = image.data
  const solid = new Uint8Array(w * h)

  for (let i = 0; i < w * h; i++) {
    const isSolid = (px[i * 4 + 3] ?? 0) >= SOLID_ALPHA

    solid[i] = isSolid ? 1 : 0
    px[i * 4 + 3] = isSolid ? OPAQUE : 0
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x

      if (solid[i] === 0 && isNextToSolid(solid, { x, y, w, h })) {
        px[i * 4] = OUTLINE_RGB[0]
        px[i * 4 + 1] = OUTLINE_RGB[1]
        px[i * 4 + 2] = OUTLINE_RGB[2]
        px[i * 4 + 3] = OPAQUE
      }
    }
  }

  c.putImageData(image, 0, 0)
}

function isNextToSolid(
  solid: Uint8Array,
  at: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
): boolean {
  const { x, y, w, h } = at
  const i = y * w + x

  return (
    (x > 0 && solid[i - 1] === 1) ||
    (x < w - 1 && solid[i + 1] === 1) ||
    (y > 0 && solid[i - w] === 1) ||
    (y < h - 1 && solid[i + w] === 1)
  )
}

function rot(az: number, ay: number): Mat {
  const ca = Math.cos(az)
  const sa = Math.sin(az)
  const cb = Math.cos(ay)
  const sb = Math.sin(ay)

  return [cb * ca, -cb * sa, sb, sa, ca, 0, -sb * ca, sb * sa, cb]
}

function mul(a: Mat, b: Mat): Mat {
  return Array.from({ length: 9 }, (_, n) => {
    const i = Math.floor(n / 3)
    const j = n % 3

    return (
      (a[i * 3] ?? 0) * (b[j] ?? 0) +
      (a[i * 3 + 1] ?? 0) * (b[3 + j] ?? 0) +
      (a[i * 3 + 2] ?? 0) * (b[6 + j] ?? 0)
    )
  })
}

function apply(m: Mat, v: Vec3): Vec3 {
  const at = (i: number): number => m[i] ?? 0

  return [
    at(0) * v[0] + at(1) * v[1] + at(2) * v[2],
    at(3) * v[0] + at(4) * v[1] + at(5) * v[2],
    at(6) * v[0] + at(7) * v[1] + at(8) * v[2],
  ]
}

function mix(a: string, b: string, t: number): string {
  const channels = (hex: string): number[] =>
    [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  const from = channels(a)
  const to = channels(b)

  return `#${from
    .map((v, i) =>
      Math.round(v + ((to[i] ?? v) - v) * t)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}
