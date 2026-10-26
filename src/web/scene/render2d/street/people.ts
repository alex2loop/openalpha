import type { MovingScene } from '@/web/scene/render2d/street/paint'
import type { ErrandItem, PersonView } from '@/web/scene/street-types'
import { drawHeldSprite, drawSprite } from '@/web/scene/render2d/street/detail'
import {
  facingDirOf,
  GEAR_BOX,
  HAT_KINDS,
  isSideOn,
  paintArms,
  paintFace,
  paintHat,
  paintUmbrella,
  paintWave,
  STREET_UMBRELLAS,
} from '@/web/scene/render2d/street/people-gear'
import { PERSON_BOX, STREET_PEOPLE } from '@/web/scene/render2d/street/rider-art'
import { paintGroundShadow } from '@/web/scene/render2d/street/shadow'
import { heldKeyOf, SPRITE_PX } from '@/web/scene/render2d/street/sprite-key'
import { DARK_STEPS, mixTone } from '@/web/scene/render2d/street/tone'
import { fill, toneOf } from '@/web/scene/render2d/street/vehicle-art'
import { HELD_TONES, PALETTE, RAMP } from '@/web/scene/sprites/palette'
import {
  type HairTone,
  LOOK_PARTS,
  lookOf,
  PANTS_OF,
  type PantsTone,
} from '@/web/scene/sprites/parts'
import {
  ERRAND_ITEMS,
  HEADINGS,
  PERSON_KINDS,
  STREET_FIGURE_H,
  WAVE_FRAME,
} from '@/web/scene/street-types'

type Rect4 = readonly [number, number, number, number]

const PERSON_PREFIX = 'person'
// A passer-by's colours come from the street palette; an office person keeps their own, listed
// first in each palette.
const STREET = STREET_PEOPLE
const OWN_SKINS = LOOK_PARTS.body.map((body) => RAMP.skin[body][1])
const OWN_SHIRTS = LOOK_PARTS.shirt.map((shirt) => RAMP.shirt[shirt][1])
const HAIR_TONES = Object.keys(RAMP.hair) as readonly HairTone[]
const OWN_HAIRS = HAIR_TONES.map((tone) => RAMP.hair[tone][1])
const PANTS_TONES = Object.keys(RAMP.pants) as readonly PantsTone[]
const OWN_PANTS = PANTS_TONES.map((tone) => RAMP.pants[tone][1])
const SKINS = [...OWN_SKINS, ...STREET.skins]
const SHIRTS = [...OWN_SHIRTS, ...STREET.shirts]
const HAIRS = [...OWN_HAIRS, ...STREET.hairs]
const PANTS = [...OWN_PANTS, ...STREET.pants]
// Plain backpacks; pupils wear a white shirt and dark trousers.
const PACKS = ['#C9544A', '#3F7FC5', '#E0A13A', '#5CA27A', '#8E5BB5'] as const
// A pupil wears the street's navy trousers.
const PUPIL_PANTS = OWN_PANTS.length + 3
const FRAMES = 7
// Bits of a passer-by's look seed each colour is drawn from.
const LOOK_BITS = Object.freeze({ hair: 2, shirt: 4, pants: 7, pack: 9 })
const TONES = Object.freeze({
  black: '#000000',
  shoe: '#1F2230',
  stool: '#C9544A',
  stoolLeg: '#7A3A34',
})
// The figure, in world px from its feet: legs standing, the walking legs from the hip, torso,
// head and hair, a pupil's backpack, arms from the middle detail up, eyes close up.
const BODY = Object.freeze({
  legs: [
    [-0.75, -1.8, 0.65, 1.8],
    [0.1, -1.8, 0.65, 1.8],
  ],
  frontLegs: [-0.85, 0.15],
  legW: 0.7,
  hip: -1.95,
  hipHalf: 0.3,
  shoe: [0.6, 0.25],
  torso: [-0.95, -3.3, 1.9, 1.6],
  head: [0, -4, 0.85],
  hair: [0, -4.15, 0.88],
  packBack: [-0.85, -3.3, 1.7, 1.6],
  packSide: [-0.35, -3.2, 0.8, 1.5],
  packStraps: [-1, -3.2, 0.25, 1],
  sleeveShade: 0.15,
  shoes: [
    [-0.8, -0.25, 0.7, 0.25],
    [0.1, -0.25, 0.7, 0.25],
  ],
  shine: [0.2, -3.2, 0.24, 0.5],
  shineLighten: 0.25,
} as const)
// A stride: the step's reach (wider at the far detail, so it reads), the passing foot's place
// and lift, the bounce on each contact, a jogger's longer reach.
const GAIT = Object.freeze({
  reach: 1.05,
  farReach: 0.25,
  passing: 0.7,
  lift: 0.8,
  bob: 0.3,
  jog: 1.35,
})
const SEAT = Object.freeze({
  stool: [-1.1, -1, 2.2, 0.5],
  leg: [-0.9, -0.5, 1.8, 0.5],
  thigh: [-0.95, -1.8, 1.9, 0.9],
  shin: { reach: 1.05, top: -0.95, w: 0.6, h: 0.8 },
} as const)
// Where a held thing hangs, side on and face on, and each thing's body and band.
const HELD_X = Object.freeze({ side: 1.2, front: 1.5 })
const ITEM_SHAPES = Object.freeze({
  cup: [
    [-0.4, -3.1, 0.8, 1.1],
    [-0.5, -3.3, 1, 0.25],
  ],
  bag: [
    [-0.6, -2.5, 1.2, 1.4],
    [-0.6, -2.5, 1.2, 0.28],
  ],
  box: [
    [-0.9, -2.9, 1.8, 0.95],
    [-0.9, -2.5, 1.8, 0.22],
  ],
} as const satisfies Record<ErrandItem, readonly [Rect4, Rect4]>)

/** What a person's picture is painted from: their colours, pose and the darkness. */
interface Figure {
  readonly g: CanvasRenderingContext2D
  readonly person: PersonView
  readonly tones: Tones
  readonly detail: number
  readonly dark: number
}

interface Tones {
  readonly skin: number
  readonly hair: number
  readonly shirt: number
  readonly pants: number
  readonly pack: number
}

// Reused for every person drawn; filled before each draw.
const drawn: { -readonly [K in keyof Tones]: number } = {
  skin: 0,
  hair: 0,
  shirt: 0,
  pants: 0,
  pack: 0,
}

/** One person at their place: a walker with their gait, a waiter, a sitter at the café, a pupil
 *  with a backpack, or someone from the office out on an errand, with what they carry. */
export function drawPerson(
  g: CanvasRenderingContext2D,
  person: PersonView,
  scene: MovingScene
): void {
  const detail = scene.minute.detail
  const darkStep = Math.round(scene.minute.light.dark * DARK_STEPS)

  paintGroundShadow(g, scene.minute, { at: person.at, w: 2.8, h: STREET_FIGURE_H })
  tonesOf(person, drawn)

  const held = heldKeyOf(person, {
    sig: sigOf(person, { detail, darkStep }),
    prefix: PERSON_PREFIX,
  })

  if (drawHeldSprite(g, held.fullKey, person.at)) {
    return
  }

  const tones = { ...drawn }
  const isTall = person.umbrella > 0 || person.hat > 0
  const box = isTall ? GEAR_BOX : PERSON_BOX

  drawSprite(
    g,
    {
      key: held.key,
      box: {
        w: PERSON_BOX.w,
        h: box.h,
        anchor: { x: PERSON_BOX.w / 2, y: box.anchorY },
        pxPerWorld: SPRITE_PX[detail],
      },
      at: person.at,
    },
    (sprite) => paintPerson({ g: sprite, person, tones, detail, dark: darkStep / DARK_STEPS })
  )
}

// A passer-by's colours from their seed; an office person's from their own look.
function tonesOf(person: PersonView, into: { -readonly [K in keyof Tones]: number }): void {
  const { look, staff } = person

  into.pack = (look >>> LOOK_BITS.pack) % PACKS.length

  if (staff !== undefined) {
    const own = lookOf(staff.id, staff.role, staff.look)

    into.skin = LOOK_PARTS.body.indexOf(own.body)
    into.hair = HAIR_TONES.indexOf(own.hairTone)
    into.shirt = LOOK_PARTS.shirt.indexOf(own.shirt)
    into.pants = PANTS_TONES.indexOf(PANTS_OF[own.shirt])
    return
  }

  into.skin = OWN_SKINS.length + (look % STREET.skins.length)
  into.hair = OWN_HAIRS.length + ((look >>> LOOK_BITS.hair) % STREET.hairs.length)
  into.shirt = OWN_SHIRTS.length + ((look >>> LOOK_BITS.shirt) % STREET.shirts.length)
  into.pants =
    person.kind === 'pupil'
      ? PUPIL_PANTS
      : OWN_PANTS.length + ((look >>> LOOK_BITS.pants) % STREET.pants.length)
}

// Everything the picture depends on, packed into one number, the detail level its lowest digit.
function sigOf(
  person: PersonView,
  at: { readonly detail: number; readonly darkStep: number }
): number {
  let sig = PERSON_KINDS.indexOf(person.kind)

  sig = sig * SKINS.length + drawn.skin
  sig = sig * HAIRS.length + drawn.hair
  sig = sig * SHIRTS.length + drawn.shirt
  sig = sig * PANTS.length + drawn.pants
  sig = sig * PACKS.length + drawn.pack
  sig = sig * HEADINGS.length + HEADINGS.indexOf(person.facing)
  sig = sig * FRAMES + Math.min(FRAMES - 1, person.frame)
  sig = sig * (ERRAND_ITEMS.length + 1) + itemIndexOf(person.item)
  sig = sig * (DARK_STEPS + 1) + at.darkStep
  sig = sig * (STREET_UMBRELLAS.length + 1) + person.umbrella
  sig = sig * HAT_KINDS + person.hat

  return sig * SPRITE_PX.length + at.detail
}

function itemIndexOf(item: ErrandItem | undefined): number {
  return item === undefined ? 0 : ERRAND_ITEMS.indexOf(item) + 1
}

function paintPerson(figure: Figure): void {
  const { g, person } = figure
  const frame = person.frame >= WAVE_FRAME ? 0 : person.frame

  if (person.kind === 'sitter' || person.kind === 'bench-sitter') {
    paintSeated(figure, person.kind === 'sitter')
  } else {
    paintLegs(figure, frame)
  }

  const bob = frame > 0 && frame % 2 === 1 ? GAIT.bob : 0

  g.save()
  g.translate(0, bob)
  paintTorso(figure, frame)
  paintHead(figure)
  paintHat(g, { person, detail: figure.detail, seed: figure.tones.shirt }, (hex) =>
    colourOf(figure, hex)
  )
  paintWave(g, { frame: person.frame, hand: colourOf(figure, SKINS[figure.tones.skin]) })
  paintItem(figure)
  paintUmbrella(g, person, (hex) => colourOf(figure, hex))
  g.restore()
}

// Standing, or a walk frame: 1 and 3 the feet apart, 2 and 4 one foot passing the other.
function paintLegs(figure: Figure, frame: number): void {
  const { g, person } = figure
  const pants = colourOf(figure, PANTS[figure.tones.pants])

  if (frame === 0) {
    for (const leg of BODY.legs) {
      fill(g, pants, leg)
    }

    return
  }

  const isPassing = frame % 2 === 0
  const lift = isPassing ? GAIT.lift : 0
  const reach =
    (GAIT.reach + (figure.detail === 0 ? GAIT.farReach : 0)) *
    (person.kind === 'jogger' ? GAIT.jog : 1)
  const ahead = strideOf(frame) * reach * facingDirOf(person)

  if (isSideOn(person)) {
    paintLeg(g, { foot: isPassing ? 0 : -ahead, lift: 0, colour: pants })
    paintLeg(g, { foot: isPassing ? reach * GAIT.passing : ahead, lift, colour: pants })
    return
  }

  const [left, right] = BODY.frontLegs

  fill(g, pants, [left, BODY.hip, BODY.legW, -BODY.hip - (frame === 2 ? lift : 0)])
  fill(g, pants, [right, BODY.hip, BODY.legW, -BODY.hip - (frame === 4 ? lift : 0)])
}

// The leading foot of a walk frame: forward on 1, back on 3, under the body when passing.
function strideOf(frame: number): -1 | 0 | 1 {
  if (frame === 1) {
    return 1
  }

  return frame === 3 ? -1 : 0
}

function paintLeg(
  g: CanvasRenderingContext2D,
  leg: { readonly foot: number; readonly lift: number; readonly colour: string }
): void {
  const half = BODY.hipHalf
  const [shoeW, shoeH] = BODY.shoe

  g.fillStyle = leg.colour
  g.beginPath()
  g.moveTo(-half, BODY.hip)
  g.lineTo(half, BODY.hip)
  g.lineTo(leg.foot + half, -leg.lift)
  g.lineTo(leg.foot - half, -leg.lift)
  g.closePath()
  g.fill()
  fill(g, TONES.shoe, [leg.foot - shoeW / 2, -leg.lift - shoeH, shoeW, shoeH])
}

// Legs forward, on a low stool by the café or on a park bench, which the park paints itself.
function paintSeated(figure: Figure, isOnStool: boolean): void {
  const { g } = figure
  const pants = colourOf(figure, PANTS[figure.tones.pants])
  const dir = facingDirOf(figure.person)
  const { shin } = SEAT

  if (isOnStool) {
    fill(g, colourOf(figure, TONES.stoolLeg), SEAT.leg)
    fill(g, colourOf(figure, TONES.stool), SEAT.stool)
  }

  fill(g, pants, SEAT.thigh)
  fill(g, pants, [dir * shin.reach - shin.w / 2, shin.top, shin.w, shin.h])
}

function paintTorso(figure: Figure, frame: number): void {
  const { g, person, tones } = figure
  const shirt = person.kind === 'pupil' ? PALETTE.paper : (SHIRTS[tones.shirt] ?? PALETTE.paper)

  if (person.kind === 'pupil') {
    fill(g, colourOf(figure, PACKS[tones.pack]), packOf(person))
  }

  fill(g, colourOf(figure, shirt), BODY.torso)

  if (figure.detail === 0) {
    return
  }

  paintArms(g, {
    person,
    stride: strideOf(frame),
    sleeve: colourOf(figure, mixTone(shirt, TONES.black, BODY.sleeveShade)),
    hand: colourOf(figure, SKINS[tones.skin]),
  })

  if (frame === 0) {
    for (const shoe of BODY.shoes) {
      fill(g, colourOf(figure, TONES.shoe), shoe)
    }
  }

  if (figure.detail === 2 && isSideOn(person)) {
    const [x, y, w, h] = BODY.shine

    fill(g, colourOf(figure, mixTone(shirt, PALETTE.glint, BODY.shineLighten)), [
      -facingDirOf(person) * x - w / 2,
      y,
      w,
      h,
    ])
  }
}

// A backpack seen from behind, from the side, or its straps from the front.
function packOf(person: PersonView): Rect4 {
  if (person.facing === 'north') {
    return BODY.packBack
  }

  return isSideOn(person) ? BODY.packSide : BODY.packStraps
}

function paintHead(figure: Figure): void {
  const { g, person, tones } = figure
  const [headX, headY, headR] = BODY.head
  const [hairX, hairY, hairR] = BODY.hair

  g.fillStyle = colourOf(figure, SKINS[tones.skin])
  g.beginPath()
  g.arc(headX, headY, headR, 0, Math.PI * 2)
  g.fill()

  if (person.kind !== 'jogger' && (person.facing !== 'south' || figure.detail >= 1)) {
    g.fillStyle = colourOf(figure, HAIRS[tones.hair])
    g.beginPath()
    g.arc(hairX, hairY, hairR, Math.PI, Math.PI * 2)

    if (person.facing === 'north') {
      g.arc(hairX, headY, hairR, 0, Math.PI * 2)
    }

    g.fill()
  }

  if (figure.detail === 2) {
    paintFace(g, { person, eye: colourOf(figure, PALETTE.eye) })
  }
}

// A cup, a bag or a box in the hand, in its held tones.
function paintItem(figure: Figure): void {
  const { g, person } = figure
  const { item } = person

  if (item === undefined) {
    return
  }

  const x = isSideOn(person) ? facingDirOf(person) * HELD_X.side : HELD_X.front
  const [body, band] = HELD_TONES[item]
  const [shape, edge] = ITEM_SHAPES[item]

  fill(g, colourOf(figure, body), [shape[0] + x, shape[1], shape[2], shape[3]])
  fill(g, item === 'cup' ? PALETTE.cupRim : colourOf(figure, band), [
    edge[0] + x,
    edge[1],
    edge[2],
    edge[3],
  ])
}

function colourOf(figure: Figure, hex: string | undefined): string {
  return toneOf(figure, hex ?? TONES.shoe)
}
