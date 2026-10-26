import type { BikeShape, RiderGear } from '@/web/scene/street-types'
import { paintBikeEnd } from '@/web/scene/render2d/street/bike-end'
import {
  type BikeArt,
  type BikeBuild,
  CM_ALONG,
  CM_UP,
  type HelmetStyle,
  type Pillion,
  paintBikeSide,
} from '@/web/scene/render2d/street/bike-model'
import { paintLabel } from '@/web/scene/render2d/street/label'
import { type Art, dirOf, fill, isAlongX, toneOf } from '@/web/scene/render2d/street/vehicle-art'
import { PALETTE } from '@/web/scene/sprites/palette'
import { tr } from '@/web/text/tr'

// Plain colours only: no maker's paint, no mark on a jacket or a box.
const BODY_TONES: Readonly<Record<BikeShape, readonly string[]>> = Object.freeze({
  'step-through': ['#C23B3B', '#2B2E36', '#2F5D9E', '#E8E6E0', '#3C8A5C'],
  scooter: ['#E8E6E0', '#B33A3A', '#2F5D9E', '#2B2E36', '#9AA3AE', '#C9B98A'],
  maxi: ['#F2F2EE', '#2B2E36', '#C0393B', '#8FB6D6', '#9CC7B0'],
  sport: ['#2F5D9E', '#3A3F4A', '#C9A227', '#C23B3B', '#8C949E'],
})
const BUILDS: Readonly<Record<BikeShape, BikeBuild>> = Object.freeze({
  'step-through': 'underbone',
  scooter: 'scooter',
  maxi: 'scooter',
  sport: 'sport',
})
const HELMET_TONES = [
  '#23262E',
  '#E9E6DD',
  '#C23B3B',
  '#2F5D9E',
  '#E3B73B',
  '#8B9099',
  '#E58AB0',
  '#4B8F6B',
  '#E26A2C',
] as const
const RIDER_TONES = [
  '#3E5C8A',
  '#B5483F',
  '#4B7F5E',
  '#D9A93A',
  '#6B6F7A',
  '#E7E4DC',
  '#2E3340',
  '#8A5A8C',
  '#C57A3E',
] as const
const COAT_TONES = [
  '#E56E9B',
  '#4FA3C7',
  '#8E6FC0',
  '#F0A24A',
  '#53B28A',
  '#D95D5D',
  '#2F3E66',
  '#A9AEB6',
] as const
const HAILING_TONES = ['#4DAE78', '#35A5B2', '#E56A3E'] as const
const MASK_TONES = ['#E9E6DD', '#7FB3D9', '#2E3340', '#E9E6DD'] as const
const PANT_TONES = ['#2E3340', '#3B4458', '#5B6272', '#2D3A4F', '#7A6E5C'] as const
const PUPIL = Object.freeze({ shirt: '#F2F0EA', pants: '#2D3A4F' })
// Shares out of a hundred: helmets (a sport rider favours a full face), side-saddle pillions.
const HELMET_ROLL = Object.freeze({ fullSport: 60, half: 50, visor: 78 })
const SIDE_SADDLE_ROLL = 27
const ROLL_MIX = 2654435761
const JACKETS: Readonly<Record<RiderGear, readonly string[]>> = Object.freeze({
  plain: RIDER_TONES,
  sunCoat: COAT_TONES,
  rideHailing: HAILING_TONES,
})
/** The street's people: skins, shirts, trousers and hair of passers-by, riders and workers. */
export const STREET_PEOPLE = Object.freeze({
  skins: ['#E8C4A0', '#D9AE86', '#C99A74', '#B98562'],
  shirts: ['#7EA7C9', '#C98A8A', '#8FB89A', '#D9C27A', '#9C8FC0', '#E0E0DC', '#6D7F99', '#C9A27A'],
  pants: ['#3B4458', '#5B6272', '#8A7C68', '#2D3A4F'],
  hairs: ['#2B2433', '#4A3A32', '#6A5A4A', '#C9C4B8'],
})
const SKINS = STREET_PEOPLE.skins
const PANTS = STREET_PEOPLE.pants
const TONES = Object.freeze({
  vest: '#E8892B',
  vestBand: '#F4F1E8',
  cart: '#3F8A5C',
  broom: '#9B7A52',
  ticket: PALETTE.paper,
  ink: '#FFFFFF',
  fallback: '#262932',
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
// The delivery box's word, close up: where it sits on the box from the side and from the back.
const BOX_WORD = Object.freeze({
  along: -84,
  up: -100,
  endAlong: -102,
  endUp: 107,
  size: 0.55,
  w: 40,
})
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
const BIKE_BOX = Object.freeze({
  side: { w: 9, h: 7.6, anchorY: 6.6 },
  end: { w: 4, h: 10.6, anchorY: 7.6 },
})
/** The sprite box of a standing person. */
export const PERSON_BOX = Object.freeze({ w: 6, h: 7, anchorY: 6.2 })

/** The sprite box of anything on two wheels, or of a sweeper, along or across its street. */
export function bikeBoxOf(art: { readonly vehicle: Art['vehicle'] }): {
  readonly w: number
  readonly h: number
  readonly anchorY: number
} {
  return isAlongX(art.vehicle.heading) ? BIKE_BOX.side : BIKE_BOX.end
}

/** A motorbike with its rider in a helmet, a sun coat and mask or a plain ride-hailing jacket,
 *  maybe a passenger or a pupil behind, a delivery box; a foot down when stopped. */
export function paintBike(art: Art): void {
  const model = modelOf(art)
  const dir = dirOf(art.vehicle.heading)

  if (isAlongX(art.vehicle.heading)) {
    art.g.save()
    art.g.scale(dir, 1)
    paintBikeSide(model)
    art.g.restore()
    paintBoxWord(art, { x: -dir * BOX_WORD.along * CM_ALONG, y: BOX_WORD.up * CM_UP + 0.1 })
    return
  }

  paintBikeEnd(model, { dir, isParked: false })

  if (dir < 0) {
    paintBoxWord(art, { x: 0, y: -BOX_WORD.endAlong * CM_ALONG - BOX_WORD.endUp * CM_UP })
  }
}

/** A motorbike parked head-in: no rider, seen from the back. */
export function paintParkedBike(art: Art): void {
  paintBikeEnd(modelOf(art), { dir: -1, isParked: true })
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

// A bare head.
function paintHead(
  art: Art,
  at: { readonly at: readonly [number, number, number]; readonly skin: string }
): void {
  const { g } = art
  const [x, y, r] = at.at

  g.fillStyle = toneOf(art, at.skin)
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()
}

// A delivery box's word, close up, drawn unmirrored over the side view.
function paintBoxWord(art: Art, at: { readonly x: number; readonly y: number }): void {
  if (art.detail < 2 || art.vehicle.kind !== 'delivery') {
    return
  }

  paintLabel(art.g, tr(art.pack.words.delivery), {
    x: at.x,
    y: at.y,
    size: BOX_WORD.size,
    colour: TONES.ink,
    maxW: BOX_WORD.w * CM_ALONG,
  })
}

interface Looks {
  readonly skin: string
  readonly pants: string
}

// A standing person's colours from the look seed.
function looksOf(art: Art): Looks {
  const { look } = art.vehicle

  return {
    skin: pickTone(SKINS, look >>> LOOK_BITS.skin),
    pants: pickTone(PANTS, look >>> LOOK_BITS.pants),
  }
}

// The model art for a motorbike: every colour from the look seed; a ride-hailing or delivery
// rider wears a plain jacket, a delivery box in its colour.
function modelOf(art: Art): BikeArt {
  const { vehicle } = art
  const { look, gear } = vehicle
  const at = (bits: number): number => look >>> bits
  const jacket = pickTone(JACKETS[gear], at(LOOK_BITS.jacket))
  const pillion = vehicle.passenger ? pillionOf(art) : undefined

  return {
    g: art.g,
    detail: art.detail,
    tone: (hex) => toneOf(art, hex),
    look: {
      build: BUILDS[vehicle.bike],
      body: pickTone(BODY_TONES[vehicle.bike], look),
      jacket,
      helmet: pickTone(HELMET_TONES, at(LOOK_BITS.helmet)),
      helmetStyle: helmetStyleOf(vehicle),
      skin: pickTone(SKINS, at(LOOK_BITS.skin)),
      pants: pickTone(PANT_TONES, at(LOOK_BITS.pants)),
      mask: pickTone(MASK_TONES, at(LOOK_BITS.mask)),
      isCoated: gear === 'sunCoat',
      isFootDown: vehicle.footDown,
      ...(pillion === undefined ? {} : { pillion }),
      ...(vehicle.kind === 'delivery' ? { box: jacket } : {}),
    },
  }
}

function pillionOf(art: Art): Pillion {
  const { look, kind } = art.vehicle
  const isPupil = kind === 'school'
  const roll = look >>> LOOK_BITS.passenger

  return {
    jacket: isPupil ? PUPIL.shirt : pickTone(RIDER_TONES, roll),
    pants: isPupil ? PUPIL.pants : pickTone(PANT_TONES, roll >>> 2),
    helmet: pickTone(HELMET_TONES, roll >>> 1),
    skin: pickTone(SKINS, roll >>> 3),
    isSideSaddle: !isPupil && rollOf(look, 1) < SIDE_SADDLE_ROLL,
    isPupil,
  }
}

function helmetStyleOf(vehicle: Art['vehicle']): HelmetStyle {
  const roll = rollOf(vehicle.look, 2)

  if (vehicle.bike === 'sport') {
    return roll < HELMET_ROLL.fullSport ? 'full' : 'half'
  }

  if (vehicle.gear === 'sunCoat') {
    return roll < HELMET_ROLL.half ? 'half' : 'visor'
  }

  if (roll < HELMET_ROLL.half) {
    return 'half'
  }

  return roll < HELMET_ROLL.visor ? 'visor' : 'full'
}

// A share out of a hundred drawn from the look seed, a different one per `salt`.
function rollOf(look: number, salt: number): number {
  return (Math.imul(look + salt, ROLL_MIX) >>> 0) % 100
}

function pickTone(tones: readonly string[], roll: number): string {
  return tones[roll % tones.length] ?? TONES.fallback
}
