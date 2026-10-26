import type { StreetDetail } from '@/web/scene/render2d/street/detail'
import type { Heading, VehicleView } from '@/web/scene/street-types'
import type { RegionPack } from '@/web/scene/world/regions'
import { paintLabel } from '@/web/scene/render2d/street/label'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { vehicleSizeOf } from '@/web/scene/sim/street/spawn'
import { HEIGHT_K } from '@/web/scene/view'
import { tr } from '@/web/text/tr'

const NIGHT_SHARE = 0.55
const WHITE = '#FFFFFF'
const SHADOW = 'rgba(0,0,0,.18)'
// Body height in world px before the tilt, by size or kind.
const HEIGHTS = Object.freeze({
  small: 3.8,
  mid: 3.3,
  large: 3.5,
  taxi: 3.3,
  bus: 5.2,
  garbage: 4.4,
})
// The body sits this far up from its ground line; its shadow falls this far down and across.
const LIFT = 0.8
const SHADOW_SHIFT = [0.4, 0.6] as const
// The cabin as shares of the body: along it, across it, and how far back it sits.
const BUS_CABIN = Object.freeze({ long: 0.92, wide: 0.82, roofLighten: 0.34 })
const BUS_GLASS_H = 2.1
const BUS_ROUND = Object.freeze({ body: 1.6, roof: 1.2 })
const BUS_DOOR = Object.freeze({ at: 0.36, w: 0.9, tone: '#10141E' })
const BUS_SIDE_ROUTE = Object.freeze({
  back: 1.5,
  rise: 1.1,
  size: 1.2,
  ink: 'rgba(255,255,255,.92)',
})
const BUS_WINDOWS = 7
const WHEEL = Object.freeze({ at: 0.3, r: 0.95, up: 0.95 })
const LAMP = Object.freeze({ inset: 0.6, w: 0.6, h: 0.9, face: 0.34, faceW: 1, faceH: 0.5 })
const ROUTE_BOX = Object.freeze({ w: 2.4, h: 1, word: 0.8, back: 2.6 })
const TRUCK = Object.freeze({ cab: 4.4, stripe: 0.7, word: 1 })
const TONES = Object.freeze({
  glass: '#3C4558',
  wheel: '#171B26',
  head: '#FFF3C4',
  tail: '#D8453B',
  routeBox: '#0E1424',
  routeInk: '#FFB84A',
  cab: '#F2F1EC',
  truckBox: '#2F6E48',
  stripe: '#E8892B',
  ink: '#FFFFFF',
})

/** What a vehicle's picture is painted from: its sprite, the vehicle, the pack's colours, the
 *  detail level and the darkness step. */
export interface Art {
  readonly g: CanvasRenderingContext2D
  readonly vehicle: VehicleView
  readonly pack: RegionPack
  readonly detail: StreetDetail
  readonly dark: number
}

type Rect4 = readonly [number, number, number, number]

/** A bus: a long body, a band of windows, and its route on the destination box close up. */
export function paintBus(art: Art): void {
  const { vehicle, pack } = art
  const tones = pack.vehicles.colours.bus
  const body = tones[vehicle.look % tones.length] ?? WHITE
  const shape = shapeOf(vehicle, HEIGHTS.bus)
  const cabin = cabinOf(shape, { ...BUS_CABIN, back: 0 })

  paintBody(art, { shape, body, cabin, glassH: BUS_GLASS_H, lighten: BUS_CABIN.roofLighten })

  if (art.detail > 0) {
    paintWheels(art, shape)
    paintLamps(art, shape)
    paintWindowPosts(art, { shape, cabin, body })
  }

  if (art.detail === 2 && vehicle.route !== '') {
    paintRoute(art, { shape, cabin })
  }
}

/** The garbage truck: a white cab at the front, the green box, an orange band, and its word on
 *  the box close up. */
export function paintTruck(art: Art): void {
  const { g, pack } = art
  const shape = shapeOf(art.vehicle, HEIGHTS.garbage)
  const { across, deep, rise, dir, isSide } = shape
  const top = -deep / 2 - LIFT - rise
  const isCabEast = isSide && dir > 0
  const cabX = isCabEast ? across / 2 - TRUCK.cab : -across / 2
  const cabW = isSide ? TRUCK.cab : across

  fill(g, SHADOW, [-across / 2 + SHADOW_SHIFT[0], -deep / 2 + SHADOW_SHIFT[1], across, deep])
  fill(g, toneOf(art, pack.vehicles.colours.truck), [-across / 2, -deep / 2 - LIFT, across, deep])
  fill(g, toneOf(art, TONES.truckBox), [-across / 2, top, across, rise + deep * 0.8])
  fill(g, toneOf(art, TONES.stripe), [
    -across / 2,
    deep / 2 - LIFT - TRUCK.stripe * 2,
    across,
    TRUCK.stripe,
  ])
  fill(g, toneOf(art, TONES.cab), [cabX, top + rise * 0.4, cabW, rise * 0.6 + deep * 0.4])

  if (art.detail > 0) {
    paintWheels(art, shape)
    paintLamps(art, shape)
  }

  if (art.detail === 2 && isSide) {
    paintLabel(g, tr(pack.words.truck), {
      x: (-dir * TRUCK.cab) / 2,
      y: top + rise / 2,
      size: TRUCK.word,
      colour: TONES.ink,
      maxW: across - TRUCK.cab - 1,
    })
  }
}

/** A vehicle's sprite box: its size seen along or across the street, its rise, and room around. */
export function boxOf(
  vehicle: VehicleView,
  height: number
): { readonly w: number; readonly h: number; readonly anchorY: number } {
  const shape = shapeOf(vehicle, height)
  const pad = 1.5

  return {
    w: shape.across + pad * 2,
    h: shape.deep + shape.rise + LIFT + pad * 2,
    anchorY: shape.deep / 2 + shape.rise + LIFT + pad,
  }
}

/** The height a vehicle's body rises to, before the tilt. */
export function heightOf(vehicle: VehicleView): number {
  if (vehicle.kind === 'car') {
    return HEIGHTS[vehicle.car]
  }

  return vehicle.kind === 'taxi' || vehicle.kind === 'bus' || vehicle.kind === 'garbage'
    ? HEIGHTS[vehicle.kind]
    : 0
}

export function isAlongX(heading: Heading): boolean {
  return heading === 'east' || heading === 'west'
}

/** 1 heading east or south (down the world's axes), -1 west or north. */
export function dirOf(heading: Heading): 1 | -1 {
  return heading === 'east' || heading === 'south' ? 1 : -1
}

export function toneOf(art: { readonly dark: number }, hex: string): string {
  return mixTone(hex, NIGHT_TONE, art.dark * NIGHT_SHARE)
}

export function fill(g: CanvasRenderingContext2D, colour: string, rect: Rect4): void {
  g.fillStyle = colour
  g.fillRect(rect[0], rect[1], rect[2], rect[3])
}

export interface Shape {
  readonly isSide: boolean
  readonly dir: 1 | -1
  readonly across: number
  readonly deep: number
  readonly rise: number
}

// The drawn extent: along the street on the north street, across it end on in a side street.
export function shapeOf(vehicle: VehicleView, height: number): Shape {
  const [len, width] = vehicleSizeOf(vehicle)
  const isSide = isAlongX(vehicle.heading)
  const dir = dirOf(vehicle.heading)

  return {
    isSide,
    dir,
    across: isSide ? len : width,
    deep: isSide ? width : len,
    rise: height * HEIGHT_K,
  }
}

function cabinOf(
  shape: Shape,
  share: { readonly long: number; readonly wide: number; readonly back: number }
): Rect4 {
  const w = shape.across * (shape.isSide ? share.long : share.wide)
  const h = shape.deep * (shape.isSide ? share.wide : share.long)
  const x = -w / 2 - (shape.isSide ? shape.dir * share.back * shape.across : 0)
  const y = -h / 2 - shape.rise - (shape.isSide ? 0 : shape.dir * share.back * shape.deep)

  return [x, y, w, h]
}

function paintBody(
  art: Art,
  at: {
    readonly shape: Shape
    readonly body: string
    readonly cabin: Rect4
    readonly glassH: number
    readonly lighten: number
  }
): void {
  const { g } = art
  const { across, deep } = at.shape
  const [x, y, w, h] = at.cabin

  fill(g, SHADOW, [-across / 2 + SHADOW_SHIFT[0], -deep / 2 + SHADOW_SHIFT[1], across, deep])
  g.fillStyle = toneOf(art, at.body)
  g.beginPath()
  g.roundRect(-across / 2, -deep / 2 - LIFT, across, deep, BUS_ROUND.body)
  g.fill()
  fill(g, toneOf(art, TONES.glass), [x, y + h, w, at.glassH])
  g.fillStyle = toneOf(art, mixTone(at.body, WHITE, at.lighten))
  g.beginPath()
  g.roundRect(x, y, w, h, BUS_ROUND.roof)
  g.fill()
}

function paintWheels(art: Art, shape: Shape): void {
  const { g } = art

  if (!shape.isSide) {
    return
  }

  g.fillStyle = toneOf(art, TONES.wheel)

  for (const side of [-1, 1]) {
    g.beginPath()
    g.arc(side * shape.across * WHEEL.at, shape.deep / 2 - WHEEL.up, WHEEL.r, 0, Math.PI * 2)
    g.fill()
  }
}

// Head lamps at the front, tail lamps at the back; end on, the pair on the face it shows.
function paintLamps(art: Art, shape: Shape): void {
  const { g } = art
  const { across, deep, dir } = shape

  if (shape.isSide) {
    fill(g, toneOf(art, TONES.head), [
      dir * (across / 2 - LAMP.inset) - LAMP.w / 2,
      -LAMP.w,
      LAMP.w,
      LAMP.h,
    ])
    fill(g, toneOf(art, TONES.tail), [
      -dir * (across / 2 - LAMP.inset) - LAMP.w / 2,
      -LAMP.w,
      LAMP.w,
      LAMP.h,
    ])
    return
  }

  const face = toneOf(art, dir > 0 ? TONES.head : TONES.tail)

  for (const side of [-1, 1]) {
    fill(g, face, [
      side * across * LAMP.face - LAMP.faceW / 2,
      deep / 2 - LIFT - LAMP.faceH,
      LAMP.faceW,
      LAMP.faceH,
    ])
  }
}

function paintWindowPosts(
  art: Art,
  at: { readonly shape: Shape; readonly cabin: Rect4; readonly body: string }
): void {
  const [x, y, w, h] = at.cabin

  if (!at.shape.isSide) {
    return
  }

  for (let index = 1; index < BUS_WINDOWS; index++) {
    fill(art.g, toneOf(art, at.body), [
      x + (index * w) / BUS_WINDOWS - 0.16,
      y + h,
      0.32,
      BUS_GLASS_H,
    ])
  }
}

function paintRoute(art: Art, at: { readonly shape: Shape; readonly cabin: Rect4 }): void {
  const { g, vehicle } = art
  const { shape } = at
  const x = shape.isSide ? shape.dir * (shape.across / 2 - ROUTE_BOX.back) : 0
  const y = at.cabin[1] + at.cabin[3] - ROUTE_BOX.h

  fill(g, TONES.routeBox, [x - ROUTE_BOX.w / 2, y - ROUTE_BOX.h / 2, ROUTE_BOX.w, ROUTE_BOX.h])
  paintLabel(g, vehicle.route, {
    x,
    y,
    size: ROUTE_BOX.word,
    colour: TONES.routeInk,
    maxW: ROUTE_BOX.w,
  })

  if (!shape.isSide) {
    return
  }

  const [cx, cy, cw, ch] = at.cabin

  fill(g, toneOf(art, BUS_DOOR.tone), [
    cx + cw * BUS_DOOR.at,
    cy + ch + 0.2,
    BUS_DOOR.w,
    BUS_GLASS_H - 0.2,
  ])
  paintLabel(g, vehicle.route, {
    x: -shape.dir * BUS_SIDE_ROUTE.back,
    y: shape.deep / 2 - LIFT - BUS_SIDE_ROUTE.rise - 0.2,
    size: BUS_SIDE_ROUTE.size,
    colour: BUS_SIDE_ROUTE.ink,
    maxW: shape.across / 2,
  })
}

// A plain roof sign, its word only close up.
