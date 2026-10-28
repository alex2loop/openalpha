import type { CityScene } from '@/web/scene/render2d/street/city-blocks'
import type { GymMachine, Park } from '@/web/scene/sim/street/park-layout'
import type { Point } from '@/web/scene/types'
import { paintLabel } from '@/web/scene/render2d/street/label'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'

type Rect4 = readonly [number, number, number, number]

// How far night takes the parks' tones, and every tone they are painted in.
const NIGHT_SHARE = 0.6
/** The parks' tones by day; `shadeOf` takes them into the night. */
export const PARK_TONES = Object.freeze({
  shadow: 'rgba(0,0,0,.14)',
  path: '#E6DFCB',
  pathEdge: '#C9C1AB',
  hedge: '#5FA877',
  rail: '#9AA3B0',
  post: '#ABA397',
  postCap: '#D8D2C4',
  benchLeg: '#4A5262',
  benchSeat: '#9B7A52',
  benchBack: '#7A5C3C',
  benchLight: '#C9A878',
  stone: '#B8B1A3',
  stoneDark: '#8E887C',
  stoneLight: '#CFC9BC',
  water: '#6FB2D0',
  waterLight: '#8FC6DC',
  jet: 'rgba(235,247,255,.8)',
  ripple: 'rgba(255,255,255,.4)',
  plate: '#2F7D4F',
  plateInk: '#F6F2D6',
  gym: { blue: '#2F6FC0', orange: '#F0A02C', grey: '#8A93A6', dark: '#2B3040' },
  play: {
    blue: '#3F7FC5',
    red: '#E8643A',
    yellow: '#E8B53A',
    rope: '#8A93A6',
    swing: '#C9544A',
    seat: '#2E3A55',
    board: '#3FA06B',
  },
})
const PATH_WIDTHS = Object.freeze({ edge: 5, path: 3.6 })
const HEDGE = Object.freeze({ step: 4.2, r: 2.3, gap: 5.6, railH: 3.2 })
// Each gym machine as frames and bars in the gym's tones: [tone, x, y, w, h] about its foot.
const MACHINES: Readonly<
  Record<GymMachine, readonly (readonly [keyof typeof PARK_TONES.gym, ...Rect4])[]>
> = Object.freeze({
  air: [
    ['grey', -2.2, -0.4, 4.4, 0.4],
    ['blue', -0.4, -5, 0.8, 5],
    ['orange', -2.6, -4.7, 5.2, 0.5],
    ['dark', -2.6, -1.5, 1.8, 0.5],
    ['dark', 0.8, -1, 1.8, 0.5],
  ],
  press: [
    ['grey', -2.4, -0.4, 4.8, 0.4],
    ['dark', -1.6, -2, 2, 0.8],
    ['dark', -1.6, -3.8, 0.6, 1.9],
    ['blue', 1.4, -4.2, 0.5, 4.2],
    ['orange', -0.2, -3.6, 2.2, 0.45],
  ],
  bike: [
    ['grey', -2.6, -0.4, 5.2, 0.4],
    ['dark', -2.4, -2.7, 1.6, 0.6],
    ['blue', -1.7, -2.2, 0.4, 1.9],
    ['blue', 1.9, -4.5, 0.4, 4.2],
    ['orange', -0.4, -2.9, 2.6, 2.6],
  ],
  pull: [
    ['blue', -1.8, -5.7, 0.5, 5.7],
    ['blue', 1.3, -5.7, 0.5, 5.7],
    ['blue', -2, -5.9, 4, 0.5],
    ['orange', -1.3, -4.5, 2.6, 0.4],
    ['dark', -0.9, -1.6, 1.8, 0.7],
  ],
  twist: [
    ['grey', -0.4, -0.7, 0.8, 0.7],
    ['orange', -1.8, -1.4, 3.6, 1.1],
    ['blue', -0.35, -5, 0.7, 4.2],
    ['blue', -1.4, -5.2, 2.8, 0.45],
  ],
  bars: [
    ['blue', -2.6, -5.2, 0.5, 5.2],
    ['blue', 2.1, -5.2, 0.5, 5.2],
    ['orange', -2.6, -5.4, 5.2, 0.5],
    ['grey', -2.1, -2.7, 4.2, 0.35],
  ],
})
const GYM_SIGN = Object.freeze({ w: 18, h: 3.7, rise: 6.2, text: 2.2 })
const PLATE = Object.freeze({ w: 14, h: 3, rise: 5.6, text: 1.4 })

/** A park tone as night takes it. */
export function shadeOf(scene: { readonly dark: number }, hex: string): string {
  return mixTone(hex, NIGHT_TONE, scene.dark * NIGHT_SHARE)
}

/** Every path of the park: a darker edge under the gravel. */
export function paintPaths(scene: CityScene, park: Park): void {
  const { g } = scene

  g.lineCap = 'round'
  g.lineJoin = 'round'

  for (const [tone, width] of [
    [PARK_TONES.pathEdge, PATH_WIDTHS.edge],
    [PARK_TONES.path, PATH_WIDTHS.path],
  ] as const) {
    g.strokeStyle = shadeOf(scene, tone)
    g.lineWidth = width
    g.beginPath()

    for (const [a, b] of park.edges) {
      const from = park.nodes[a]
      const to = park.nodes[b]

      if (from !== undefined && to !== undefined) {
        g.moveTo(from.x, from.y)
        g.lineTo(to.x, to.y)
      }
    }

    g.stroke()
  }
}

/** A low hedge with a railing through it along a park's street edge, from `from` to `to` along
 *  x (`isAlongX`) or y, open at each gate, with a post either side of a gate. */
export function paintHedgeRail(
  scene: CityScene,
  edge: {
    readonly line: number
    readonly from: number
    readonly to: number
    readonly isAlongX: boolean
    readonly gaps: readonly number[]
  }
): void {
  const { g } = scene
  const at = (along: number, across: number): Point =>
    edge.isAlongX ? { x: along, y: edge.line + across } : { x: edge.line + across, y: along }

  for (let along = edge.from; along < edge.to; along += HEDGE.step) {
    if (edge.gaps.some((gap) => Math.abs(along - gap) < HEDGE.gap)) {
      continue
    }

    const point = at(along, 0)

    g.fillStyle = shadeOf(scene, PARK_TONES.hedge)
    g.beginPath()
    g.arc(point.x, point.y, HEDGE.r, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = shadeOf(scene, PARK_TONES.rail)
    g.fillRect(point.x - 0.15, point.y - HEDGE.railH + 1.4, 0.3, HEDGE.railH)
  }

  for (const gap of edge.gaps) {
    for (const side of [-1, 1]) {
      const post = at(gap + side * HEDGE.gap, 0)

      g.fillStyle = shadeOf(scene, PARK_TONES.post)
      g.fillRect(post.x - 0.8, post.y - 4, 1.6, 4.4)
      g.fillStyle = shadeOf(scene, PARK_TONES.postCap)
      g.fillRect(post.x - 1, post.y - 4.6, 2, 0.7)
    }
  }
}

/** A side-on bench at `at`, its sitter facing east (1) or west (-1), the backrest behind them. */
export function paintBench(
  scene: CityScene,
  at: { readonly at: Point; readonly facing: -1 | 1 }
): void {
  const { g } = scene
  const { x, y } = at.at
  const back = at.facing > 0 ? -1.5 : 1.1

  ellipse(g, { x, y: y + 0.3, rx: 1.5, ry: 0.6, colour: PARK_TONES.shadow })
  g.fillStyle = shadeOf(scene, PARK_TONES.benchLeg)
  g.fillRect(x - 1, y - 1.5, 0.3, 1.6)
  g.fillRect(x + 0.7, y - 1.5, 0.3, 1.6)
  g.fillStyle = shadeOf(scene, PARK_TONES.benchSeat)
  g.fillRect(x - 1.3, y - 1.6, 2.6, 0.5)
  g.fillStyle = shadeOf(scene, PARK_TONES.benchBack)
  g.fillRect(x + back, y - 3.6, 0.4, 2.1)

  if (scene.minute.detail >= 1) {
    g.fillStyle = shadeOf(scene, PARK_TONES.benchLight)
    g.fillRect(x - 1.3, y - 1.6, 2.6, 0.15)
  }
}

/** The fountain: a stone basin, its water and the jets from the middle; ripples close up. */
export function paintFountain(scene: CityScene, at: Point): void {
  const { g } = scene
  const { x, y } = at

  for (const [radius, tone, dy] of [
    [8.4, PARK_TONES.stone, 0],
    [8, PARK_TONES.stoneDark, 0.5],
    [7.9, PARK_TONES.stoneLight, 0],
    [6.7, PARK_TONES.water, 0],
  ] as const) {
    ellipse(g, { x, y: y + dy, rx: radius, ry: radius, colour: shadeOf(scene, tone) })
  }

  g.fillStyle = shadeOf(scene, PARK_TONES.stoneLight)
  g.fillRect(x - 0.55, y - 4.6, 1.1, 4.6)
  ellipse(g, { x, y: y - 4.6, rx: 2.7, ry: 1, colour: shadeOf(scene, PARK_TONES.stoneLight) })
  ellipse(g, { x, y: y - 4.7, rx: 2.2, ry: 0.7, colour: shadeOf(scene, PARK_TONES.waterLight) })
  g.strokeStyle = PARK_TONES.jet
  g.lineWidth = 0.38
  g.beginPath()
  g.moveTo(x, y - 5)
  g.lineTo(x, y - 8)

  for (const side of [-1, 1]) {
    g.moveTo(x + side * 0.6, y - 4.9)
    g.quadraticCurveTo(x + side * 3.2, y - 8.4, x + side * 4.8, y - 0.6)
  }

  g.stroke()

  if (scene.minute.detail >= 1) {
    g.strokeStyle = PARK_TONES.ripple
    g.lineWidth = 0.3

    for (const radius of [3.2, 5]) {
      g.beginPath()
      g.arc(x, y, radius, 0, 1.2)
      g.stroke()
    }
  }
}

/** A slide, a swing or a seesaw at its place on the playground's rubber floor. */
export function paintPlayPiece(
  scene: CityScene,
  piece: { readonly kind: 'slide' | 'swing' | 'seesaw'; readonly x: number; readonly y: number }
): void {
  const { g } = scene
  const { x, y } = piece
  const tone = (hex: string): string => shadeOf(scene, hex)

  ellipse(g, { x, y: y + 0.4, rx: 3.8, ry: 1, colour: PARK_TONES.shadow })

  if (piece.kind === 'slide') {
    paintSlide(g, { x, y, tone })
  } else if (piece.kind === 'swing') {
    paintSwing(g, { x, y, tone })
  } else {
    paintSeesaw(g, { x, y, tone })
  }
}

/** A playground piece's foot and its tones as night takes them. */
interface PlaySpot {
  readonly x: number
  readonly y: number
  readonly tone: (hex: string) => string
}

function paintSlide(g: CanvasRenderingContext2D, at: PlaySpot): void {
  const { x, y, tone } = at
  const { play } = PARK_TONES

  fillRects(g, tone(play.blue), [
    [x - 2.6, y - 3.2, 0.35, 3.2],
    [x - 0.9, y - 3.2, 0.35, 3.2],
  ])
  fillRects(g, tone(play.red), [[x - 2.9, y - 3.5, 2.7, 0.45]])
  g.fillStyle = tone(play.yellow)
  g.beginPath()
  g.moveTo(x - 0.6, y - 3.2)
  g.quadraticCurveTo(x + 1.8, y - 1.9, x + 3.8, y - 0.1)
  g.lineTo(x + 3.8, y - 0.7)
  g.quadraticCurveTo(x + 2, y - 2.4, x - 0.6, y - 3.2)
  g.fill()
}

function paintSwing(g: CanvasRenderingContext2D, at: PlaySpot): void {
  const { x, y, tone } = at
  const { play } = PARK_TONES

  fillRects(g, tone(play.swing), [
    [x - 3.6, y - 3.8, 0.35, 3.9],
    [x + 3.25, y - 3.8, 0.35, 3.9],
    [x - 3, y - 4, 6, 0.35],
  ])
  fillRects(g, tone(play.rope), [
    [x - 2, y - 3.8, 0.12, 2.6],
    [x + 1.9, y - 3.8, 0.12, 2.6],
  ])
  fillRects(g, tone(play.seat), [
    [x - 2.3, y - 1.3, 1.6, 0.35],
    [x + 0.6, y - 1.3, 1.6, 0.35],
  ])
}

function paintSeesaw(g: CanvasRenderingContext2D, at: PlaySpot): void {
  const { x, y, tone } = at
  const { play } = PARK_TONES

  fillRects(g, tone(play.rope), [[x - 0.4, y - 0.9, 0.8, 1]])
  g.fillStyle = tone(play.board)
  g.beginPath()
  g.moveTo(x - 3.4, y - 0.3)
  g.lineTo(x + 3.4, y - 1.8)
  g.lineTo(x + 3.4, y - 1.35)
  g.lineTo(x - 3.4, y + 0.15)
  g.fill()
}

/** One of the outdoor gym's machines at its foot. */
export function paintGymMachine(scene: CityScene, at: Point & { readonly kind: GymMachine }): void {
  const { g } = scene

  ellipse(g, { x: at.x, y: at.y + 0.3, rx: 3.6, ry: 0.9, colour: PARK_TONES.shadow })

  for (const [tone, x, y, w, h] of MACHINES[at.kind]) {
    g.fillStyle = shadeOf(scene, PARK_TONES.gym[tone])
    g.fillRect(at.x + x, at.y + y, w, h)
  }
}

/** A green board on two posts, its word close up (a plain bar further out): the gym's sign or the
 *  park's name plate. */
export function paintSign(
  scene: CityScene,
  sign: { readonly at: Point; readonly text: string; readonly isPlate: boolean }
): void {
  const { g } = scene
  const { x, y } = sign.at
  const size = sign.isPlate ? PLATE : GYM_SIGN
  const top = y - size.rise
  const half = size.w / 2

  g.fillStyle = shadeOf(scene, PARK_TONES.rail)
  g.fillRect(x - half + 1, top, 0.6, size.rise)
  g.fillRect(x + half - 1.6, top, 0.6, size.rise)
  g.fillStyle = shadeOf(scene, PARK_TONES.plate)
  g.fillRect(x - half, top, size.w, size.h)

  if (scene.minute.detail === 0) {
    g.fillStyle = shadeOf(scene, PARK_TONES.plateInk)
    g.fillRect(x - half * 0.6, top + size.h * 0.4, size.w * 0.6, size.h * 0.2)
    return
  }

  paintLabel(g, sign.text, {
    x,
    y: top + size.h / 2,
    size: size.text,
    colour: shadeOf(scene, PARK_TONES.plateInk),
    maxW: size.w - 1,
  })
}

/** A filled ellipse. */
export function ellipse(
  g: CanvasRenderingContext2D,
  at: {
    readonly x: number
    readonly y: number
    readonly rx: number
    readonly ry: number
    readonly colour: string | CanvasGradient
  }
): void {
  g.fillStyle = at.colour
  g.beginPath()
  g.ellipse(at.x, at.y, at.rx, at.ry, 0, 0, Math.PI * 2)
  g.fill()
}

function fillRects(g: CanvasRenderingContext2D, colour: string, rects: readonly Rect4[]): void {
  g.fillStyle = colour

  for (const [x, y, w, h] of rects) {
    g.fillRect(x, y, w, h)
  }
}
