import type { Art } from '@/web/scene/render2d/street/critter-shapes'
import type { MovingScene } from '@/web/scene/render2d/street/paint'
import type { CritterKind, CritterView } from '@/web/scene/street-types'
import { paintPigeon, paintSparrow } from '@/web/scene/render2d/street/critter-birds'
import { paintCat, paintDog } from '@/web/scene/render2d/street/critter-pets'
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
// The cat stays a little lit at night, as under the street lamps.
const CAT_DARK_MAX = 0.72

// Reused for every lifted bird drawn.
const drawAt = { x: 0, y: 0 }

/** One animal at its place, a bird `lift` px above the ground, a dog's lead up to its walker. */
export function drawCritter(
  g: CanvasRenderingContext2D,
  critter: CritterView,
  scene: MovingScene
): void {
  const detail = scene.minute.detail
  const darkStep = Math.round(scene.minute.light.dark * DARK_STEPS)
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
  const shade = critter.kind === 'cat' ? Math.min(dark, CAT_DARK_MAX) : dark
  const art: Art = {
    g,
    critter,
    dark,
    detail: at.detail,
    tone: (hex) => shadeOf({ dark: shade }, hex),
  }
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
