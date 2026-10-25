import type { FrameSpec } from '@/web/scene/render2d/figure-spec'
import {
  type Cells,
  createCells,
  isEdge,
  put,
  SPRITE_H,
  SPRITE_W,
} from '@/web/scene/render2d/pixel-grid'
import { MASCOT_TONES, OUTLINE, PHONE_FINISHES } from '@/web/scene/sprites/palette'

// The egg, centred on the sprite, in sprite pixels.
const EGG = Object.freeze({ cx: 11.5, cy: 20.5, rx: 8.6, ry: 9.2, top: 12, bottom: 29 })
const SHINE: readonly (readonly [number, number])[] = [
  [6, 14],
  [7, 13],
  [8, 13],
  [5, 15],
]
const SPARKS: readonly (readonly [number, number])[] = [
  [3, 7],
  [4, 6],
  [4, 8],
  [5, 7],
  [19, 5],
  [20, 4],
  [20, 6],
  [21, 5],
]
// The logo's alpha as one bare stroke: drawn after the outline, so it reads as a single line.
const CURL = [
  '..##.....#',
  '.#..#...#.',
  '#....#.#..',
  '#.....#...',
  '#....#.#..',
  '.#..#...#.',
  '..##.....#',
]
const CURL_AT = Object.freeze({ x: 7, y: 4 })
const EYE_XS = [8, 15] as const
// Which foot is off the floor at each step of a walk: none, left, none, right.
const LIFTED_FOOT = [-1, 0, -1, 1] as const

interface Egg {
  readonly px: Cells<string>
  readonly frame: FrameSpec
  /** How far the egg rises (a hop) or sinks (a breath). */
  readonly b: number
  readonly isTalking: boolean
}

/** Bé Alpha: a gradient egg with the logo's curl. It smiles at rest, talks with round eyes while
 *  it answers, raises its brows and a hand while an approval waits, and hops only to cheer. */
export function buildMascot(frame: FrameSpec): Cells<string> {
  const isCheer = frame.arms === 'cheer'
  const egg: Egg = {
    px: createCells(),
    frame,
    b: riseOf(frame),
    isTalking: frame.arms === 'type',
  }

  paintEgg(egg)
  paintFeet(egg)
  paintLimbs(egg)

  if (frame.phone === 'read' && !frame.isBack) {
    paintPhone(egg)
  }

  if (!frame.isBack) {
    paintMascotFace(egg)
  }

  const out = outlined(egg.px)

  if (isCheer && frame.isHop === true) {
    for (const at of SPARKS) {
      put(out, at, MASCOT_TONES.spark)
    }
  }

  paintCurl(out, egg.b)

  return out
}

// A hop lifts the egg a pixel; a breath sinks it one.
function riseOf(frame: FrameSpec): number {
  if (frame.arms === 'cheer') {
    return frame.isHop === true ? -1 : 0
  }

  return frame.isBob ? 1 : 0
}

// The logo blue at the top fading to violet at the feet.
function paintEgg(egg: Egg): void {
  const { top, bottom } = MASCOT_TONES

  for (let y = EGG.top; y <= EGG.bottom; y++) {
    const t = (y - EGG.top) / (EGG.bottom - EGG.top)
    const tone = `rgb(${top.map((c, i) => Math.round(c + ((bottom[i] ?? c) - c) * t)).join(',')})`

    for (let x = 2; x < SPRITE_W - 2; x++) {
      const dx = (x - EGG.cx) / EGG.rx
      const dy = (y - EGG.cy) / EGG.ry

      if (dx * dx + dy * dy <= 1) {
        put(egg.px, [x, y + egg.b], tone)
      }
    }
  }

  for (const [x, y] of SHINE) {
    put(egg.px, [x, y + egg.b], MASCOT_TONES.shine)
  }
}

function paintFeet(egg: Egg): void {
  const gait = egg.frame.gait
  const lifted = LIFTED_FOOT[gait ?? 0]

  for (const [foot, x0] of [
    [0, 7],
    [1, 14],
  ] as const) {
    for (let x = x0; x < x0 + 3; x++) {
      put(egg.px, [x, SPRITE_H - 2], MASCOT_TONES.feet)

      if (lifted !== foot) {
        put(egg.px, [x, SPRITE_H - 1], MASCOT_TONES.feet)
      }
    }
  }
}

function paintLimbs(egg: Egg): void {
  const { px, b, frame } = egg
  const lift = egg.isTalking ? 1 : 0
  const { limb, palm } = MASCOT_TONES

  put(px, [1, 21 + b + lift], limb)
  put(px, [2, 20 + b + lift], limb)
  put(px, [1, 22 + b + lift], limb)

  if (frame.arms === 'cheer') {
    for (const [x, d] of [
      [1, 1],
      [22, -1],
    ] as const) {
      put(px, [x + d, 15 + b], limb)
      put(px, [x, 14 + b], limb)
      put(px, [x, 13 + b], limb)
      put(px, [x, 12 + b], palm)
    }
  } else if (frame.arms === 'hand') {
    put(px, [21, 15 + b], limb)
    put(px, [22, 14 + b], limb)
    put(px, [22, 13 + b], limb)
    put(px, [22, 12 + b], palm)

    if (frame.phone === 'call') {
      paintCallPhone(egg)
    }
  } else {
    put(px, [22, 21 + b], limb)
    put(px, [21, 20 + b + lift], limb)
    put(px, [22, 22 + b + lift], limb)
  }
}

function paintCallPhone(egg: Egg): void {
  const [body, edge, plate] = PHONE_FINISHES[egg.frame.finish] ?? PHONE_FINISHES[0]

  for (let y = 6; y < 12; y++) {
    put(egg.px, [22, y + egg.b], body)
    put(egg.px, [23, y + egg.b], body)
  }

  put(egg.px, [22, 6 + egg.b], edge)
  put(egg.px, [23, 6 + egg.b], edge)
  put(egg.px, [23, 7 + egg.b], plate)
}

function paintPhone(egg: Egg): void {
  const [body, edge] = PHONE_FINISHES[egg.frame.finish] ?? PHONE_FINISHES[0]
  const { px, b } = egg

  for (let x = 9; x < 15; x++) {
    for (let y = 17; y < 24; y++) {
      const isRim = y === 23 || x === 9 || x === 14

      const tone = isRim ? body : MASCOT_TONES.screen

      put(px, [x, y + b], y === 17 ? edge : tone)
    }
  }

  for (const x of [7, 8, 15, 16]) {
    put(px, [x, 22 + b], MASCOT_TONES.limb)
  }
}

function paintMascotFace(egg: Egg): void {
  const { px, b } = egg

  for (const ex of EYE_XS) {
    paintMascotEye(egg, ex)
  }

  put(px, [6, 21 + b], MASCOT_TONES.cheek)
  put(px, [17, 21 + b], MASCOT_TONES.cheek)
  paintMascotMouth(egg)
}

function paintMascotEye(egg: Egg, ex: number): void {
  const { px, b, frame } = egg
  const { ink } = MASCOT_TONES
  const isWaiting = frame.arms === 'hand'

  if (frame.isBlink || frame.arms === 'relax') {
    for (let d = -1; d < 2; d++) {
      put(px, [ex + d, 19 + b], ink)
    }
  } else if (isWaiting || egg.isTalking) {
    paintRoundEye(egg, ex)
  } else if (frame.isAside === true || frame.isDown === true) {
    const gx = frame.isAside === true ? 1 : 0
    const gy = frame.isDown === true ? 1 : 0

    put(px, [ex + gx, 18 + b + gy], ink)
    put(px, [ex + gx, 19 + b + gy], ink)
  } else {
    put(px, [ex - 1, 19 + b], ink)
    put(px, [ex, 18 + b], ink)
    put(px, [ex + 1, 19 + b], ink)
  }

  if (isWaiting) {
    put(px, [ex - 1, 16 + b], ink)
    put(px, [ex + 2, 16 + b], ink)
  }
}

// Round eyes with a glint: answering, or waiting on an approval.
function paintRoundEye(egg: Egg, ex: number): void {
  const { px, b } = egg

  for (const [dx, dy] of [
    [0, 18],
    [1, 18],
    [0, 19],
    [1, 19],
  ] as const) {
    put(px, [ex + dx, dy + b], MASCOT_TONES.ink)
  }

  put(px, [egg.isTalking ? ex : ex + 1, 18 + b], MASCOT_TONES.palm)
}

function paintMascotMouth(egg: Egg): void {
  const { px, b, frame } = egg
  const { ink, talk } = MASCOT_TONES

  if (egg.isTalking) {
    put(px, [11, 22 + b], talk)
    put(px, [12, 22 + b], talk)

    if (frame.beat === 1) {
      put(px, [11, 23 + b], talk)
      put(px, [12, 23 + b], talk)
    }
  } else if (frame.arms === 'hand') {
    for (let x = 10; x < 14; x++) {
      put(px, [x, 23 + b], ink)
    }
  } else {
    put(px, [10, 22 + b], ink)
    put(px, [11, 23 + b], ink)
    put(px, [12, 23 + b], ink)
    put(px, [13, 22 + b], ink)
  }
}

function outlined(px: Cells<string>): Cells<string> {
  const out = [...px]

  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      if (px[y * SPRITE_W + x] === undefined && isEdge(px, x, y)) {
        out[y * SPRITE_W + x] = OUTLINE
      }
    }
  }

  return out
}

function paintCurl(out: Cells<string>, b: number): void {
  CURL.forEach((row, y) => {
    ;[...row].forEach((mark, x) => {
      if (mark === '#') {
        put(out, [CURL_AT.x + x, CURL_AT.y + y + b], MASCOT_TONES.curl)
      }
    })
  })
}
