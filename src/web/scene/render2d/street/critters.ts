import type { MovingScene } from '@/web/scene/render2d/street/paint'
import type { CritterKind, CritterView } from '@/web/scene/street-types'
import { darknessOf } from '@/web/scene/render2d/street/city'
import { paintCat, paintDog } from '@/web/scene/render2d/street/critter-pets'
import { type Art, ellipse, line, poly, STRIDE } from '@/web/scene/render2d/street/critter-shapes'
import { drawHeldSprite, drawSprite } from '@/web/scene/render2d/street/detail'
import { shadeOf } from '@/web/scene/render2d/street/park-props'
import { heldKeyOf, SPRITE_PX } from '@/web/scene/render2d/street/sprite-key'
import { DARK_STEPS } from '@/web/scene/render2d/street/tone'
import { CRITTER_KINDS, CRITTER_POSES } from '@/web/scene/street-types'

// Each animal is drawn in centimetres (feet at 0, facing +x, up negative) and scaled to world px,
// about three times life size so it reads beside people; its sprite box about its feet.
const CM_TO_PX: Readonly<Record<CritterKind, number>> = Object.freeze({
  pigeon: 0.08,
  sparrow: 0.125,
  cat: 0.085,
  dog: 0.075,
})
const BOXES: Readonly<Record<CritterKind, { w: number; h: number; ax: number; ay: number }>> =
  Object.freeze({
    pigeon: { w: 7, h: 6, ax: 3.5, ay: 4.5 },
    sparrow: { w: 4.4, h: 3.6, ax: 2.2, ay: 2.8 },
    cat: { w: 6, h: 5, ax: 3, ay: 4.2 },
    dog: { w: 10, h: 7, ax: 5, ay: 5.6 },
  })
const FRAMES = 4
const PREFIX = 'critter'
const LEAD = Object.freeze({ tone: '#3A3330', w: 0.12, collar: { dx: 1.9, dy: -2.7 }, sag: 1 })
const PIGEON = Object.freeze({
  body: '#8D94A3',
  belly: '#A6ACB8',
  wing: '#A4AAB7',
  bar: '#2E323C',
  tail: '#4F5563',
  neck: '#5E6E9A',
  sheen: '#2F8F7A',
  head: '#5C6475',
  beak: '#3E414A',
  eye: '#E07A2A',
  leg: '#C97C84',
})
const SPARROW = Object.freeze({
  back: '#A7794F',
  dark: '#8A5733',
  belly: '#CDBFA9',
  tail: '#6E4A2C',
  head: '#E9E1D1',
  cap: '#8B4528',
  bib: '#222222',
  beak: '#4A433F',
  leg: '#C8998A',
})
// A bird's wing in flight swings from up (frame 0) to below the body (frame 2).
const WING_ANGLES = [0.2, 0.95, 2.35, 1.55] as const
const PIGEON_BOB = [-1.5, 3.2, 3.4, 0.8] as const

// Reused for every lifted bird drawn.
const drawAt = { x: 0, y: 0 }

/** One animal at its place, a bird `lift` px above the ground, a dog's lead up to its walker. */
export function drawCritter(
  g: CanvasRenderingContext2D,
  critter: CritterView,
  scene: MovingScene
): void {
  const detail = scene.minute.detail
  const darkStep = Math.round(darknessOf(scene.minute.minute) * DARK_STEPS)
  const held = heldKeyOf(critter, { sig: sigOf(critter, { detail, darkStep }), prefix: PREFIX })
  const box = BOXES[critter.kind]

  drawAt.x = critter.at.x
  drawAt.y = critter.at.y - critter.lift

  if (critter.lead !== undefined) {
    paintLead(g, critter, critter.lead)
  }

  if (drawHeldSprite(g, held.fullKey, drawAt)) {
    return
  }

  drawSprite(
    g,
    {
      key: held.key,
      box: { w: box.w, h: box.h, anchor: { x: box.ax, y: box.ay }, pxPerWorld: SPRITE_PX[detail] },
      at: drawAt,
    },
    (sprite) => paintCritter(sprite, { critter, darkStep, detail })
  )
}

function sigOf(
  critter: CritterView,
  at: { readonly detail: number; readonly darkStep: number }
): number {
  let sig = CRITTER_KINDS.indexOf(critter.kind)

  sig = sig * CRITTER_POSES.length + CRITTER_POSES.indexOf(critter.pose)
  sig = sig * FRAMES + (critter.frame % FRAMES)
  sig = sig * 2 + (critter.facing > 0 ? 1 : 0)
  sig = sig * (DARK_STEPS + 1) + at.darkStep

  return sig * SPRITE_PX.length + at.detail
}

// A thin lead from the dog's collar, sagging a little, up to the walker's hand.
function paintLead(
  g: CanvasRenderingContext2D,
  dog: CritterView,
  hand: { readonly x: number; readonly y: number }
): void {
  const x = dog.at.x + dog.facing * LEAD.collar.dx
  const y = dog.at.y + LEAD.collar.dy

  g.strokeStyle = LEAD.tone
  g.lineWidth = LEAD.w
  g.beginPath()
  g.moveTo(x, y)
  g.quadraticCurveTo((x + hand.x) / 2, Math.max(y, hand.y) + LEAD.sag, hand.x, hand.y)
  g.stroke()
}

function paintCritter(
  g: CanvasRenderingContext2D,
  at: { readonly critter: CritterView; readonly darkStep: number; readonly detail: number }
): void {
  const { critter } = at
  const dark = at.darkStep / DARK_STEPS
  const art: Art = { g, critter, dark, detail: at.detail, tone: (hex) => shadeOf({ dark }, hex) }
  const k = CM_TO_PX[critter.kind]

  g.scale(critter.facing * k, k)

  switch (critter.kind) {
    case 'pigeon':
      paintPigeon(art)
      return
    case 'sparrow':
      paintSparrow(art)
      return
    case 'cat':
      paintCat(art)
      return
    case 'dog':
      paintDog(art)
      return
    default:
      critter.kind satisfies never
  }
}

// The rock pigeon: grey with a green and purple neck, a pale wing with two dark bars, dark tail;
// its head bobs as it walks, dips to peck, and in the air its wings beat.
function paintPigeon(art: Art): void {
  const { g, critter, tone } = art
  const { frame, pose } = critter

  if (pose === 'fly') {
    paintFlight(art, {
      body: [10, 5],
      wing: [17, 6.5],
      tones: [PIGEON.body, PIGEON.wing, PIGEON.tail, PIGEON.head],
    })
    return
  }

  const reach = pose === 'walk' ? (STRIDE[frame] ?? 0) * 0.8 : 0

  line(g, { from: [-1.2, -7], to: [-1.2 + reach, -1.2], w: 1.5, tone: tone(PIGEON.leg) })
  line(g, { from: [-1.2, -7], to: [-1.2 - reach, -1.2], w: 1.5, tone: tone(PIGEON.leg) })
  poly(g, tone(PIGEON.tail), [-7, -12, -18.5, -8.4, -18, -5.4, -7, -9])
  ellipse(g, { x: -1, y: -12, rx: 10, ry: 7.6, rot: -0.2, tone: tone(PIGEON.body) })
  ellipse(g, { x: 5.5, y: -12.6, rx: 5.6, ry: 6.2, rot: 0, tone: tone(PIGEON.belly) })
  ellipse(g, { x: -3.4, y: -13.8, rx: 9, ry: 5.2, rot: -0.2, tone: tone(PIGEON.wing) })

  if (art.detail >= 1) {
    line(g, { from: [1.3, -18.6], to: [-1.9, -9.6], w: 2, tone: tone(PIGEON.bar) })
    line(g, { from: [-3.3, -18.6], to: [-6.5, -9.6], w: 2, tone: tone(PIGEON.bar) })
  }

  const bob = pose === 'walk' ? (PIGEON_BOB[frame] ?? 0) : 0.5
  const head: [number, number] = pose === 'peck' ? [13.5, -3 - frame * 3] : [9 + bob, -23]

  line(g, { from: [5.5, -15], to: head, w: 7, tone: tone(PIGEON.neck) })

  if (art.detail >= 1) {
    ellipse(g, { x: 7, y: -16.6, rx: 3.6, ry: 3.6, rot: 0, tone: tone(PIGEON.sheen) })
  }

  paintBirdHead(art, { at: head, r: 3.8, head: PIGEON.head, beak: PIGEON.beak, eye: PIGEON.eye })
}

// The tree sparrow: chestnut cap, white cheek with a black spot, black bib, streaked brown back.
function paintSparrow(art: Art): void {
  const { g, critter, tone } = art

  if (critter.pose === 'fly') {
    paintFlight(art, {
      body: [5.4, 3.2],
      wing: [10.5, 4.6],
      tones: [SPARROW.back, SPARROW.dark, SPARROW.tail, SPARROW.cap],
    })
    return
  }

  line(g, { from: [-0.2, -3.4], to: [-0.8, 0], w: 1.1, tone: tone(SPARROW.leg) })
  line(g, { from: [2, -3.4], to: [2.2, 0], w: 1.1, tone: tone(SPARROW.leg) })
  g.save()
  g.rotate(critter.pose === 'peck' ? 0.55 : 0)
  poly(g, tone(SPARROW.tail), [-6, -6.4, -14.6, -3.2, -14.2, -1.4, -5.4, -3.8])
  ellipse(g, { x: 0.3, y: -5.6, rx: 5.6, ry: 3.3, rot: -0.5, tone: tone(SPARROW.belly) })
  ellipse(g, { x: -1.4, y: -7.2, rx: 5.6, ry: 2.8, rot: -0.45, tone: tone(SPARROW.back) })
  ellipse(g, { x: -2.2, y: -7.6, rx: 4.2, ry: 2.1, rot: -0.45, tone: tone(SPARROW.dark) })
  ellipse(g, { x: 5, y: -10.3, rx: 3.7, ry: 3.5, rot: 0, tone: tone(SPARROW.head) })
  ellipse(g, { x: 5, y: -12, rx: 3.6, ry: 1.9, rot: 0, tone: tone(SPARROW.cap) })
  ellipse(g, { x: 7, y: -7.3, rx: 1.25, ry: 1.8, rot: 0.25, tone: tone(SPARROW.bib) })
  poly(g, tone(SPARROW.beak), [8, -10.9, 10.8, -9.9, 8, -8.9])

  if (art.detail >= 1) {
    ellipse(g, { x: 4.2, y: -9, rx: 0.75, ry: 0.75, rot: 0, tone: tone(SPARROW.bib) })
    ellipse(g, { x: 6.3, y: -11.1, rx: 0.7, ry: 0.7, rot: 0, tone: tone(SPARROW.bib) })
  }

  g.restore()
}

// A bird side on in the air: tail, body, the far and near wing at the beat's angle, the head.
function paintFlight(
  art: Art,
  bird: {
    readonly body: readonly [number, number]
    readonly wing: readonly [number, number]
    readonly tones: readonly [string, string, string, string]
  }
): void {
  const { g, tone } = art
  const [length, depth] = bird.body
  const [span, width] = bird.wing
  const [body, wing, tail, head] = bird.tones
  const angle = WING_ANGLES[art.critter.frame % FRAMES] ?? 0
  const tipX = -Math.sin(angle) * span * 0.4
  const tipY = -depth * 0.35 - Math.cos(angle) * span

  paintWing(g, { x: tipX / 2 - 2, y: tipY / 2, span, width, tone: tone(tail) })
  poly(g, tone(tail), [
    -length * 0.7,
    -depth * 0.35,
    -length * 1.9,
    -depth * 0.9,
    -length * 1.95,
    depth * 0.4,
    -length * 0.7,
    depth * 0.4,
  ])
  ellipse(g, { x: 0, y: 0, rx: length, ry: depth, rot: -0.14, tone: tone(body) })
  ellipse(g, {
    x: length + depth * 0.3,
    y: -depth * 0.6,
    rx: depth * 0.7,
    ry: depth * 0.7,
    rot: 0,
    tone: tone(head),
  })
  paintWing(g, { x: tipX / 2, y: tipY / 2, span, width, tone: tone(wing) })
}

// A wing from the shoulder out to (2x, 2y), as long as the span and as wide as given.
function paintWing(
  g: CanvasRenderingContext2D,
  at: {
    readonly x: number
    readonly y: number
    readonly span: number
    readonly width: number
    readonly tone: string
  }
): void {
  ellipse(g, {
    x: at.x,
    y: at.y,
    rx: at.span * 0.52,
    ry: at.width / 2,
    rot: Math.atan2(at.y, at.x),
    tone: at.tone,
  })
}

function paintBirdHead(
  art: Art,
  at: {
    readonly at: readonly [number, number]
    readonly r: number
    readonly head: string
    readonly beak: string
    readonly eye: string
  }
): void {
  const { g, tone } = art
  const [x, y] = at.at

  ellipse(g, { x, y, rx: at.r, ry: at.r * 0.92, rot: 0, tone: tone(at.head) })
  poly(g, tone(at.beak), [
    x + at.r * 0.8,
    y - 0.5,
    x + at.r * 1.8,
    y + 0.8,
    x + at.r * 0.8,
    y + 1.7,
  ])

  if (art.detail >= 1) {
    ellipse(g, { x: x + 1.2, y: y - 1, rx: 1.05, ry: 1.05, rot: 0, tone: tone(at.eye) })
  }
}
