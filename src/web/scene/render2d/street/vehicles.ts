import type { MessageKey } from '@/i18n'
import type { MovingScene, PaintPart } from '@/web/scene/render2d/street/paint'
import type { StreetSayView, VehicleView } from '@/web/scene/street-types'
import type { Point } from '@/web/scene/types'
import { darknessOf } from '@/web/scene/render2d/street/city'
import { drawHeldSprite, drawSprite, spriteKeyOf } from '@/web/scene/render2d/street/detail'
import { paintLabel } from '@/web/scene/render2d/street/label'
import {
  bikeBoxOf,
  PERSON_BOX,
  paintAttendant,
  paintBike,
  paintParkedBike,
  paintSweeper,
} from '@/web/scene/render2d/street/rider-art'
import { DARK_STEPS } from '@/web/scene/render2d/street/tone'
import {
  type Art,
  boxOf,
  dirOf,
  heightOf,
  isAlongX,
  paintBus,
  paintCar,
  paintTruck,
} from '@/web/scene/render2d/street/vehicle-art'
import { isTwoWheeler } from '@/web/scene/sim/street/flows'
import { LOOK_SEEDS, vehicleSizeOf } from '@/web/scene/sim/street/spawn'
import {
  BIKE_SHAPES,
  CAR_SIZES,
  CHATTER_IDS,
  type ChatterId,
  HEADINGS,
  type Heading,
  RIDER_GEARS,
  VEHICLE_KINDS,
} from '@/web/scene/street-types'
import { isInside } from '@/web/scene/world/rooms'
import { locale } from '@/web/state/session'
import { tr } from '@/web/text/tr'

/** Sprites are painted at these px per world px by detail level: sharp at each zoom band's top. */
export const SPRITE_PX = [2, 5, 10] as const
// Lamps light from this darkness; their dots grow brighter with it.
const LIGHTS_FROM_DARK = 0.3
const LIGHTS_GAIN = 1.2
const LAMP_DOT = 1.4
const LAMP_SPREAD = 0.28
const LAMP_RISE = 0.8
const HEAD_LIGHT = '#FFF3C4'
const TAIL_LIGHT = '#FF5A4D'
const LAMP_ENDS = [1, -1] as const
const LAMP_PAIR = [-1, 1] as const
const LAMP_SINGLE = [0] as const
// The bubble over whoever says a word, and its lettering.
const SAY = Object.freeze({ w: 9, h: 4, rise: 8, size: 2, pad: 1, tail: 1 })
const SAY_TONES = Object.freeze({ fill: '#FFFFFF', edge: '#2B2433', ink: '#2B2433' })
const LOOK_PREFIX = 'look'
const SAY_KEYS: Readonly<Record<ChatterId, MessageKey>> = Object.freeze({
  honk: 'ui.office.street.say.honk',
  eh: 'ui.office.street.say.eh',
  hello: 'ui.office.street.say.hello',
  hey: 'ui.office.street.say.hey',
})
// Parked bikes come in a few looks, from a seed per look.
const PARKED_LOOKS = 12
const PARKED_SEED_STEP = 7_919
// A parked bike's looks and the attendant's two (standing, handing a ticket over), seeded past
// every moving vehicle's look so no sprite key is shared.
const PARKED: readonly Standing[] = Array.from({ length: PARKED_LOOKS }, (_, index) =>
  createStanding({ heading: 'north', look: LOOK_SEEDS + index * PARKED_SEED_STEP })
)
const STANDING_ATTENDANT = createStanding({ heading: 'south', look: LOOK_SEEDS * 2 })
const HANDING_ATTENDANT = createStanding({ heading: 'south', look: LOOK_SEEDS * 2 + 1 })

/** A look that stands still: a parked bike or the attendant, placed before each draw. */
interface Standing {
  readonly view: VehicleView
  readonly at: { x: number; y: number }
}

/** The key a sprite is cached under, held per thing drawn while its look stays the same. */
interface HeldKey {
  sig: number
  key: string
  fullKey: string
  language: string
}

// Keyed by the pools' own slots, so it never holds more than they do.
const heldKeys = new WeakMap<object, HeldKey>()
// Where the bubble being drawn floats; set before each draw.
const sayAt = { x: 0, y: 0 }

/** The moving traffic: the parked lot and its attendant, every vehicle north to south, their
 *  lamps after dusk and the words they say. */
export const VEHICLES_PART: PaintPart = {
  paintStatic: () => undefined,
  paintMoving: (g, view, scene) => {
    const { lot } = view
    const dark = darknessOf(scene.minute.minute)

    for (let index = 0; index < lot.parked; index++) {
      const slot = lot.slots[index]
      const parked = PARKED[index % PARKED_LOOKS]

      if (slot !== undefined && parked !== undefined) {
        drawStanding(g, parked, { at: slot, scene })
      }
    }

    if (lot.attendant !== undefined) {
      const attendant = lot.attendant.handing ? HANDING_ATTENDANT : STANDING_ATTENDANT

      drawStanding(g, attendant, { at: lot.attendant.at, scene })
    }

    for (const vehicle of view.pools.vehicles) {
      if (isInside(scene.rect, vehicle.at)) {
        drawLook(g, vehicle, scene)
        paintLights(g, vehicle, dark)
      }
    }

    for (const say of view.says) {
      paintSay(g, say, scene)
    }
  },
}

function drawStanding(
  g: CanvasRenderingContext2D,
  standing: Standing,
  place: { readonly at: Point; readonly scene: MovingScene }
): void {
  if (isInside(place.scene.rect, place.at)) {
    standing.at.x = place.at.x
    standing.at.y = place.at.y
    drawLook(g, standing.view, place.scene)
  }
}

// Draws the cached sprite of the look at its place; paints it first when the look is new.
function drawLook(g: CanvasRenderingContext2D, view: VehicleView, scene: MovingScene): void {
  const detail = scene.minute.detail
  const darkStep = Math.round(darknessOf(scene.minute.minute) * DARK_STEPS)
  const held = heldKeyOf(view, { sig: sigOf(view, { detail, darkStep }), prefix: LOOK_PREFIX })

  if (drawHeldSprite(g, held.fullKey, view.at)) {
    return
  }

  const box = spriteBoxOf(view)
  const art = { vehicle: view, pack: scene.pack, detail, dark: darkStep / DARK_STEPS }

  drawSprite(
    g,
    {
      key: held.key,
      box: {
        w: box.w,
        h: box.h,
        anchor: { x: box.w / 2, y: box.anchorY },
        pxPerWorld: SPRITE_PX[detail],
      },
      at: view.at,
    },
    (sprite) => paintLook({ ...art, g: sprite })
  )
}

/** The sprite key of `owner`'s look while its signature stays `sig` (with the detail level as its
 *  lowest digit), held per owner so a hot path builds no string. */
export function heldKeyOf(
  owner: object,
  at: { readonly sig: number; readonly prefix: string }
): HeldKey {
  const { sig } = at
  const held = heldKeys.get(owner)

  if (held !== undefined && held.sig === sig) {
    return held
  }

  const key = `${at.prefix}|${sig}`
  const next = { sig, key, fullKey: spriteKeyOf(key, pxOfSig(sig)), language: '' }

  heldKeys.set(owner, next)

  return next
}

// Everything a look's picture depends on, packed into one number, with the detail level as its
// lowest digit so the key names its resolution.
function sigOf(
  view: VehicleView,
  at: { readonly detail: number; readonly darkStep: number }
): number {
  let sig = view.look

  sig = sig * VEHICLE_KINDS.length + VEHICLE_KINDS.indexOf(view.kind)
  sig = sig * CAR_SIZES.length + CAR_SIZES.indexOf(view.car)
  sig = sig * BIKE_SHAPES.length + BIKE_SHAPES.indexOf(view.bike)
  sig = sig * RIDER_GEARS.length + RIDER_GEARS.indexOf(view.gear)
  sig = sig * 2 + (view.passenger ? 1 : 0)
  sig = sig * 2 + (view.footDown ? 1 : 0)
  sig = sig * HEADINGS.length + HEADINGS.indexOf(view.heading)
  sig = sig * (DARK_STEPS + 1) + at.darkStep

  return sig * SPRITE_PX.length + at.detail
}

function pxOfSig(sig: number): number {
  return SPRITE_PX[sig % SPRITE_PX.length] ?? SPRITE_PX[0]
}

function spriteBoxOf(view: VehicleView): {
  readonly w: number
  readonly h: number
  readonly anchorY: number
} {
  if (isAttendant(view)) {
    return PERSON_BOX
  }

  return isTwoWheeler(view.kind) || view.kind === 'sweeper'
    ? bikeBoxOf({ vehicle: view })
    : boxOf(view, heightOf(view))
}

function isAttendant(view: VehicleView): boolean {
  return view === STANDING_ATTENDANT.view || view === HANDING_ATTENDANT.view
}

function paintLook(art: Art): void {
  const { vehicle } = art

  if (isAttendant(vehicle)) {
    paintAttendant(art, vehicle === HANDING_ATTENDANT.view)
  } else if (PARKED.some((parked) => parked.view === vehicle)) {
    paintParkedBike(art)
  } else if (vehicle.kind === 'bus') {
    paintBus(art)
  } else if (vehicle.kind === 'garbage') {
    paintTruck(art)
  } else if (vehicle.kind === 'sweeper') {
    paintSweeper(art)
  } else if (isTwoWheeler(vehicle.kind)) {
    paintBike(art)
  } else {
    paintCar(art)
  }
}

// Head and tail lamps after dusk: a pair at each end of a car, one each on a two-wheeler.
function paintLights(g: CanvasRenderingContext2D, vehicle: VehicleView, dark: number): void {
  if (dark <= LIGHTS_FROM_DARK || vehicle.kind === 'sweeper') {
    return
  }

  const [len, width] = vehicleSizeOf(vehicle)
  const isSide = isAlongX(vehicle.heading)
  const ahead = dirOf(vehicle.heading) * len * 0.5
  const across = width * LAMP_SPREAD
  const sides = isTwoWheeler(vehicle.kind) ? LAMP_SINGLE : LAMP_PAIR
  const y = vehicle.at.y - LAMP_RISE

  g.globalAlpha = Math.min(1, dark * LIGHTS_GAIN)

  for (const end of LAMP_ENDS) {
    g.fillStyle = end > 0 ? HEAD_LIGHT : TAIL_LIGHT

    for (const side of sides) {
      const dx = isSide ? end * ahead : side * across
      const dy = isSide ? side * across : end * ahead

      g.fillRect(vehicle.at.x + dx - LAMP_DOT / 2, y + dy - LAMP_DOT / 2, LAMP_DOT, LAMP_DOT)
    }
  }

  g.globalAlpha = 1
}

// A word in a bubble over the vehicle that says it.
function paintSay(g: CanvasRenderingContext2D, say: StreetSayView, scene: MovingScene): void {
  if (!isInside(scene.rect, say.at)) {
    return
  }

  const detail = scene.minute.detail
  const sig = CHATTER_IDS.indexOf(say.chatter) * SPRITE_PX.length + detail
  const held = sayKeyOf(say, sig)

  sayAt.x = say.at.x
  sayAt.y = say.at.y - SAY.rise

  if (drawHeldSprite(g, held.fullKey, sayAt)) {
    return
  }

  drawSprite(
    g,
    {
      key: held.key,
      box: {
        w: SAY.w,
        h: SAY.h + SAY.tail,
        anchor: { x: SAY.w / 2, y: SAY.h / 2 },
        pxPerWorld: SPRITE_PX[detail],
      },
      at: sayAt,
    },
    (sprite) => paintBubble(sprite, tr(SAY_KEYS[say.chatter]))
  )
}

// A bubble's key names the language its word is in.
function sayKeyOf(say: StreetSayView, sig: number): HeldKey {
  const language = locale.value
  const held = heldKeys.get(say)

  if (held !== undefined && held.sig === sig && held.language === language) {
    return held
  }

  const key = `say|${sig}|${language}`
  const next = { sig, key, fullKey: spriteKeyOf(key, pxOfSig(sig)), language }

  heldKeys.set(say, next)

  return next
}

function paintBubble(g: CanvasRenderingContext2D, word: string): void {
  const x = -SAY.w / 2
  const y = -SAY.h / 2

  g.fillStyle = SAY_TONES.fill
  g.strokeStyle = SAY_TONES.edge
  g.lineWidth = 0.2
  g.beginPath()
  g.roundRect(x, y, SAY.w, SAY.h, SAY.h / 2)
  g.moveTo(-SAY.tail / 2, SAY.h / 2)
  g.lineTo(0, SAY.h / 2 + SAY.tail)
  g.lineTo(SAY.tail / 2, SAY.h / 2)
  g.fill()
  g.stroke()
  paintLabel(g, word, {
    x: 0,
    y: 0,
    size: SAY.size,
    colour: SAY_TONES.ink,
    maxW: SAY.w - SAY.pad * 2,
  })
}

function createStanding(look: { readonly heading: Heading; readonly look: number }): Standing {
  const at = { x: 0, y: 0 }
  const view: VehicleView = Object.freeze({
    prev: at,
    at,
    kind: 'motorbike',
    heading: look.heading,
    car: 'mid',
    bike: 'scooter',
    gear: 'plain',
    passenger: false,
    look: look.look,
    route: '',
    footDown: false,
  })

  return { view, at }
}
