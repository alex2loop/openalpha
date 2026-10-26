import type { BikeShape, RiderGear } from '@/web/scene/street-types'
import { paintLabel } from '@/web/scene/render2d/street/label'
import { type Art, dirOf, fill, isAlongX, toneOf } from '@/web/scene/render2d/street/vehicle-art'
import { PALETTE, RAMP } from '@/web/scene/sprites/palette'
import { tr } from '@/web/text/tr'

type Rect4 = readonly [number, number, number, number]

// Plain colours only: no maker's paint, no mark on a jacket or a box.
const BIKE_TONES = [
  '#E8E6E0',
  '#B33A3A',
  '#2F5D9E',
  '#2B2E36',
  '#9AA3AE',
  '#C9B98A',
  '#3C8A5C',
] as const
const HELMET_TONES = [
  '#23262E',
  '#E9E6DD',
  '#C23B3B',
  '#2F5D9E',
  '#E3B73B',
  '#8B9099',
  '#E58AB0',
] as const
const COAT_TONES = ['#E56E9B', '#4FA3C7', '#8E6FC0', '#F0A24A', '#53B28A', '#D95D5D'] as const
const HAILING_TONES = ['#4DAE78', '#35A5B2', '#E56A3E'] as const
const MASK_TONES = ['#E9E6DD', '#7FB3D9', '#2E3340'] as const
const SHIRTS = Object.values(RAMP.shirt).map((ramp) => ramp[1])
const JACKETS: Readonly<Record<RiderGear, readonly string[]>> = Object.freeze({
  plain: SHIRTS,
  sunCoat: COAT_TONES,
  rideHailing: HAILING_TONES,
})
const SKINS = Object.values(RAMP.skin).map((ramp) => ramp[1])
const PANTS = Object.values(RAMP.pants).map((ramp) => ramp[1])
const TONES = Object.freeze({
  tyre: '#171A22',
  seat: '#262932',
  bars: '#23262F',
  head: '#FFF3C4',
  tail: '#D8453B',
  vest: '#E8892B',
  vestBand: '#F4F1E8',
  cart: '#3F8A5C',
  broom: '#9B7A52',
  ticket: PALETTE.paper,
  pupil: PALETTE.paper,
  ink: '#FFFFFF',
})
// Bits of the look seed each colour is drawn from.
const LOOK_BITS = Object.freeze({
  helmet: 3,
  jacket: 6,
  skin: 9,
  pants: 11,
  passenger: 13,
  mask: 15,
})
// A two-wheeler from the side, facing east, from the ground under its middle.
const WHEELS = Object.freeze({ x: 1.7, y: -0.7, r: 0.7 })
const SIDE_BODIES: Readonly<Record<BikeShape, readonly Rect4[]>> = Object.freeze({
  'step-through': [
    [-2.3, -1.7, 3.3, 0.45],
    [0.9, -2.6, 0.35, 1.9],
  ],
  scooter: [
    [-2.5, -2.1, 2.4, 1.1],
    [-0.2, -1.4, 1, 0.35],
    [0.8, -2.8, 0.6, 2.1],
  ],
  maxi: [
    [-2.7, -2.4, 2.8, 1.4],
    [0.1, -1.5, 0.9, 0.4],
    [0.9, -3, 0.7, 2.3],
  ],
  sport: [
    [-2.4, -2.2, 1.6, 0.6],
    [-0.6, -2.7, 1.8, 0.9],
    [0.9, -2.8, 0.35, 2.1],
  ],
})
const SIDE = Object.freeze({
  seat: [-2.1, -2.55, 1.9, 0.35],
  lamp: [1.2, -2.7, 0.35, 0.35],
  bars: [1, -3.6, 0.3, 0.9],
  thigh: [-0.9, -2.6, 1.3, 0.5],
  shin: [0.2, -2.4, 0.45, 1.1],
  footDown: [0.3, -2.4, 0.45, 2.4],
  torso: [-1.4, -4.7, 1.1, 2.2],
  coat: [-1.5, -4.7, 1.5, 3],
  arm: [-0.6, -4.2, 1.8, 0.4],
  head: [-0.85, -5.3, 0.55],
  mask: [-0.55, -5.25, 0.45, 0.3],
  rider: [-2.6, -4.4, 1, 1.9],
  riderHead: [-2.1, -5, 0.5],
  pupil: [-2.5, -4, 0.9, 1.5],
  pupilHead: [-2.05, -4.6, 0.45],
  box: [-3.3, -4.3, 1.5, 1.6],
  boxWord: 0.45,
} as const)
// The same from the front or the back, from the ground under it.
const END = Object.freeze({
  wheel: [-0.25, -1.4, 0.5, 1.4],
  body: [-0.7, -2.7, 1.4, 1.4],
  lamp: [-0.2, -2.5, 0.4, 0.3],
  bars: [-1.2, -3.3, 2.4, 0.25],
  torso: [-0.8, -4.6, 1.6, 2],
  coat: [-0.85, -4.6, 1.7, 2.6],
  arms: [
    [-1.2, -3.9, 0.4, 0.9],
    [0.8, -3.9, 0.4, 0.9],
  ],
  legs: [
    [-0.9, -2.4, 0.4, 1],
    [0.5, -2.4, 0.4, 1],
  ],
  feetDown: [
    [-1.1, -2.4, 0.4, 2.4],
    [0.7, -2.4, 0.4, 2.4],
  ],
  head: [0, -5.2, 0.55],
  mask: [-0.3, -5.15, 0.6, 0.3],
  rider: [-0.7, -5.2, 1.4, 0.8],
  riderHead: [0, -5.8, 0.5],
  box: [-0.75, -4.9, 1.5, 1.4],
  seat: [-0.5, -2.9, 1, 0.3],
} as const)
// A sweeper with a cart and a broom, and the lot's attendant, standing.
const SWEEPER = Object.freeze({
  cart: [-2.2, -2.2, 1.8, 1.6],
  legs: [0, -1.8, 0.8, 1.8],
  vest: [-0.2, -4.4, 1.2, 2.6],
  head: [0.4, -4.9, 0.5],
  hat: [
    [-0.4, -5.1],
    [0.4, -5.9],
    [1.2, -5.1],
  ],
  broom: [
    [1, -3],
    [2.4, 0],
  ],
} as const)
const ATTENDANT = Object.freeze({
  legs: [-0.45, -1.8, 0.9, 1.8],
  torso: [-0.6, -3.9, 1.2, 2.1],
  band: [-0.6, -3, 1.2, 0.3],
  head: [0, -4.4, 0.5],
  cap: [-0.55, -4.95, 1.1, 0.35],
  arm: [0.5, -3.4, 1.2, 0.35],
  ticket: [1.6, -3.6, 0.5, 0.6],
} as const)
const HELMET_SHELL = 1.08
const BIKE_BOX = Object.freeze({ side: 9, end: 4, h: 7.6, anchorY: 6.6 })
/** The sprite box of a standing person. */
export const PERSON_BOX = Object.freeze({ w: 6, h: 7, anchorY: 6.2 })

/** The sprite box of anything on two wheels, or of a sweeper, along or across its street. */
export function bikeBoxOf(art: { readonly vehicle: Art['vehicle'] }): {
  readonly w: number
  readonly h: number
  readonly anchorY: number
} {
  return {
    w: isAlongX(art.vehicle.heading) ? BIKE_BOX.side : BIKE_BOX.end,
    h: BIKE_BOX.h,
    anchorY: BIKE_BOX.anchorY,
  }
}

/** A motorbike with its rider in a helmet, a sun coat and mask or a plain ride-hailing jacket,
 *  maybe a passenger or a pupil behind, a delivery box; a foot down when stopped. */
export function paintBike(art: Art): void {
  if (isAlongX(art.vehicle.heading)) {
    const { g } = art
    const dir = dirOf(art.vehicle.heading)

    g.save()
    g.scale(dir, 1)
    paintBikeSide(art)
    g.restore()
    paintBoxWord(art, {
      x: (SIDE.box[0] + SIDE.box[2] / 2) * dir,
      y: SIDE.box[1] + SIDE.box[3] / 2,
    })
    return
  }

  paintBikeEnd(art)
}

function paintBikeSide(art: Art): void {
  const { g, vehicle } = art
  const look = looksOf(art)

  if (vehicle.kind === 'delivery') {
    fill(g, toneOf(art, look.jacket), SIDE.box)
  }

  if (vehicle.passenger) {
    const isPupil = vehicle.kind === 'school'

    fill(g, toneOf(art, isPupil ? TONES.pupil : look.passenger), isPupil ? SIDE.pupil : SIDE.rider)
    paintHead(art, {
      at: isPupil ? SIDE.pupilHead : SIDE.riderHead,
      skin: look.skin,
      helmet: look.helmet,
    })
  }

  paintMachineSide(art, look.body)
  fill(g, toneOf(art, look.pants), SIDE.thigh)
  fill(g, toneOf(art, look.pants), vehicle.footDown ? SIDE.footDown : SIDE.shin)
  fill(g, toneOf(art, look.jacket), vehicle.gear === 'sunCoat' ? SIDE.coat : SIDE.torso)
  fill(g, toneOf(art, look.jacket), SIDE.arm)
  paintHead(art, { at: SIDE.head, skin: look.skin, helmet: look.helmet })

  if (vehicle.gear === 'sunCoat') {
    fill(g, toneOf(art, look.mask), SIDE.mask)
  }
}

function paintMachineSide(art: Art, body: string): void {
  const { g } = art

  g.fillStyle = toneOf(art, TONES.tyre)

  for (const side of [-1, 1]) {
    g.beginPath()
    g.arc(side * WHEELS.x, WHEELS.y, WHEELS.r, 0, Math.PI * 2)
    g.fill()
  }

  for (const rect of SIDE_BODIES[art.vehicle.bike]) {
    fill(g, toneOf(art, body), rect)
  }

  fill(g, toneOf(art, TONES.seat), SIDE.seat)
  fill(g, toneOf(art, TONES.bars), SIDE.bars)

  if (art.detail > 0) {
    fill(g, toneOf(art, TONES.head), SIDE.lamp)
  }
}

// End on: what is behind the rider is drawn first, so a bike heading away shows its box and
// passenger over the rider's back.
function paintBikeEnd(art: Art): void {
  const { g, vehicle } = art
  const look = looksOf(art)
  const isTowardViewer = vehicle.heading === 'south'

  if (isTowardViewer) {
    paintBehind(art, look)
  }

  fill(g, toneOf(art, TONES.tyre), END.wheel)
  fill(g, toneOf(art, look.body), END.body)
  fill(g, toneOf(art, isTowardViewer ? TONES.head : TONES.tail), END.lamp)
  fill(g, toneOf(art, TONES.bars), END.bars)

  for (const leg of vehicle.footDown ? END.feetDown : END.legs) {
    fill(g, toneOf(art, look.pants), leg)
  }

  fill(g, toneOf(art, look.jacket), vehicle.gear === 'sunCoat' ? END.coat : END.torso)

  for (const arm of END.arms) {
    fill(g, toneOf(art, look.jacket), arm)
  }

  paintHead(art, { at: END.head, skin: look.skin, helmet: look.helmet })

  if (vehicle.gear === 'sunCoat' && isTowardViewer) {
    fill(g, toneOf(art, look.mask), END.mask)
  }

  if (!isTowardViewer) {
    paintBehind(art, look)
  }
}

function paintBehind(art: Art, look: Looks): void {
  const { g, vehicle } = art

  if (vehicle.passenger) {
    fill(g, toneOf(art, vehicle.kind === 'school' ? TONES.pupil : look.passenger), END.rider)
    paintHead(art, { at: END.riderHead, skin: look.skin, helmet: look.helmet })
  }

  if (vehicle.kind === 'delivery') {
    fill(g, toneOf(art, look.jacket), END.box)
  }
}

/** A motorbike parked head-in: no rider, seen from the back. */
export function paintParkedBike(art: Art): void {
  const { g } = art
  const look = looksOf(art)

  fill(g, toneOf(art, TONES.tyre), END.wheel)
  fill(g, toneOf(art, look.body), END.body)
  fill(g, toneOf(art, TONES.seat), END.seat)
  fill(g, toneOf(art, TONES.bars), END.bars)
  fill(g, toneOf(art, TONES.tail), END.lamp)
}

/** A street sweeper in a vest and a conical hat, pushing a cart with a broom out in front. */
export function paintSweeper(art: Art): void {
  const { g } = art
  const dir = dirOf(art.vehicle.heading)
  const look = looksOf(art)

  g.save()
  g.scale(dir, 1)
  fill(g, toneOf(art, TONES.cart), SWEEPER.cart)
  fill(g, toneOf(art, look.pants), SWEEPER.legs)
  fill(g, toneOf(art, TONES.vest), SWEEPER.vest)
  paintHead(art, { at: SWEEPER.head, skin: look.skin })
  g.fillStyle = toneOf(art, TONES.broom)
  g.beginPath()

  for (const [x, y] of SWEEPER.hat) {
    g.lineTo(x, y)
  }

  g.fill()
  g.strokeStyle = toneOf(art, TONES.broom)
  g.lineWidth = 0.2
  g.beginPath()
  g.moveTo(SWEEPER.broom[0][0], SWEEPER.broom[0][1])
  g.lineTo(SWEEPER.broom[1][0], SWEEPER.broom[1][1])
  g.stroke()
  g.restore()
}

/** The lot's attendant in a vest and cap, an arm out with the ticket while handing it over. */
export function paintAttendant(art: Art, isHanding: boolean): void {
  const { g } = art
  const look = looksOf(art)

  fill(g, toneOf(art, look.pants), ATTENDANT.legs)
  fill(g, toneOf(art, TONES.vest), ATTENDANT.torso)
  fill(g, toneOf(art, TONES.vestBand), ATTENDANT.band)
  paintHead(art, { at: ATTENDANT.head, skin: look.skin })
  fill(g, toneOf(art, TONES.vest), ATTENDANT.cap)

  if (isHanding) {
    fill(g, toneOf(art, TONES.vest), ATTENDANT.arm)
    fill(g, TONES.ticket, ATTENDANT.ticket)
  }
}

// A head, under a helmet's shell when one is given.
function paintHead(
  art: Art,
  at: {
    readonly at: readonly [number, number, number]
    readonly skin: string
    readonly helmet?: string
  }
): void {
  const { g } = art
  const [x, y, r] = at.at

  g.fillStyle = toneOf(art, at.skin)
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()

  if (at.helmet !== undefined) {
    g.fillStyle = toneOf(art, at.helmet)
    g.beginPath()
    g.arc(x, y, r * HELMET_SHELL, Math.PI, Math.PI * 2)
    g.fill()
  }
}

// A delivery box's word, close up, drawn unmirrored over the side view.
function paintBoxWord(art: Art, at: { readonly x: number; readonly y: number }): void {
  if (art.detail < 2 || art.vehicle.kind !== 'delivery') {
    return
  }

  paintLabel(art.g, tr(art.pack.words.delivery), {
    x: at.x,
    y: at.y,
    size: SIDE.boxWord,
    colour: TONES.ink,
    maxW: SIDE.box[2],
  })
}

interface Looks {
  readonly body: string
  readonly helmet: string
  readonly jacket: string
  readonly skin: string
  readonly pants: string
  readonly passenger: string
  readonly mask: string
}

// Every colour from the look seed; a ride-hailing or delivery rider wears a plain jacket.
function looksOf(art: Art): Looks {
  const { look, gear } = art.vehicle
  const at = (bits: number): number => look >>> bits
  const jackets = JACKETS[gear]

  return {
    body: pickTone(BIKE_TONES, look),
    helmet: pickTone(HELMET_TONES, at(LOOK_BITS.helmet)),
    jacket: pickTone(jackets, at(LOOK_BITS.jacket)),
    skin: pickTone(SKINS, at(LOOK_BITS.skin)),
    pants: pickTone(PANTS, at(LOOK_BITS.pants)),
    passenger: pickTone(SHIRTS, at(LOOK_BITS.passenger)),
    mask: pickTone(MASK_TONES, at(LOOK_BITS.mask)),
  }
}

function pickTone(tones: readonly string[], roll: number): string {
  return tones[roll % tones.length] ?? TONES.seat
}
