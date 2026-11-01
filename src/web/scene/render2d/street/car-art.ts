import type { Art, Shape } from '@/web/scene/render2d/street/vehicle-art'
import type { CarSize } from '@/web/scene/street-types'
import { paintLabel } from '@/web/scene/render2d/street/label'
import { mixTone } from '@/web/scene/render2d/street/tone'
import { fill, heightOf, shapeOf, toneOf } from '@/web/scene/render2d/street/vehicle-art'
import { tr } from '@/web/text/tr'

/** A car's build, as shares of its size: the cabin along and across it and how far back it
 *  sits, how round its corners are, the roof's rake at the windscreen and the tailgate, where the
 *  wheels sit and how big, and whether it has arches, alloy rims and a sill strip. */
interface CarSpec {
  readonly long: number
  readonly wide: number
  readonly back: number
  readonly round: number
  readonly rake: readonly [number, number]
  readonly wheelAt: number
  readonly wheelR: number
  readonly hasAlloys: boolean
  readonly hasSill: boolean
}

const CAR_SPECS: Readonly<Record<CarSize, CarSpec>> = Object.freeze({
  small: {
    long: 0.74,
    wide: 0.86,
    back: 0.06,
    round: 0.14,
    rake: [0.04, 0.02],
    wheelAt: 0.34,
    wheelR: 0.85,
    hasAlloys: false,
    hasSill: false,
  },
  mid: {
    long: 0.62,
    wide: 0.78,
    back: 0.06,
    round: 0.26,
    rake: [0.12, 0.09],
    wheelAt: 0.32,
    wheelR: 0.9,
    hasAlloys: true,
    hasSill: false,
  },
  large: {
    long: 0.56,
    wide: 0.8,
    back: 0.04,
    round: 0.34,
    rake: [0.2, 0.17],
    wheelAt: 0.31,
    wheelR: 1.05,
    hasAlloys: true,
    hasSill: true,
  },
})
const LIFT = 0.8
const GLASS_H = 1.3
const ROOF_LIGHTEN = 0.3
const SHADOW = 'rgba(0,0,0,.18)'
const SHADOW_SHIFT = [0.4, 0.6] as const
const TAXI_SIGN = Object.freeze({ w: 2.4, h: 0.9, word: 0.55, tone: '#F4D35E', ink: '#1A1C22' })
const TONES = Object.freeze({
  white: '#FFFFFF',
  glass: '#3C4558',
  glint: 'rgba(255,255,255,.22)',
  arch: '#242936',
  wheel: '#171B26',
  chrome: '#D5DAE3',
  head: '#FFF3C4',
  headSide: '#F6EFD2',
  tail: '#D8453B',
  seam: 'rgba(0,0,0,.28)',
  handle: '#D9DEE6',
  rim: '#B9C0CC',
  spoke: '#454B5A',
  hub: '#2A2F3C',
  grille: '#222733',
  plate: '#F2F4F7',
  bumper: '#171B26',
  lip: '#000000',
})

/** The cabin's rect and the depth of the glass band under its roof. */
interface Cabin {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** A car or taxi seen from the side on the north street, or end on in a side street, in its
 *  pack colour; a taxi carries its roof sign. */
export function paintCar(art: Art): void {
  const { vehicle, pack } = art
  const colours = pack.vehicles.colours
  const isTaxi = vehicle.kind === 'taxi'
  const body = isTaxi
    ? colours.taxi
    : (colours.car[vehicle.car][vehicle.look % colours.car[vehicle.car].length] ?? TONES.white)
  const cabin = paintCarModel(art, {
    shape: shapeOf(vehicle, heightOf(vehicle)),
    body,
    size: isTaxi ? 'mid' : vehicle.car,
  })

  if (isTaxi) {
    paintTaxiSign(art, { x: cabin.x + cabin.w / 2, y: cabin.y + cabin.h / 2 })
  }
}

/** A car of `size` in `body`: its shadow and rounded body, the glass band and the raked roof,
 *  then pillars, wheels and lamps (or the face end on) from the middle detail, and doors, handles,
 *  rims and the nose strip close up. Returns the cabin, for whatever sits on the roof. */
function paintCarModel(
  art: Art,
  car: { readonly shape: Shape; readonly body: string; readonly size: CarSize }
): Cabin {
  const { g } = art
  const { across, deep, rise, dir, isSide } = car.shape
  const spec = CAR_SPECS[car.size]
  const w = across * (isSide ? spec.long : spec.wide)
  const h = deep * (isSide ? spec.wide : spec.long)
  const cabin: Cabin = {
    x: -w / 2 - (isSide ? dir * spec.back * across : 0),
    y: -h / 2 - rise - (isSide ? 0 : dir * spec.back * deep),
    w,
    h,
  }
  const roof = toneOf(art, mixTone(car.body, TONES.white, ROOF_LIGHTEN))

  fill(g, SHADOW, [-across / 2 + SHADOW_SHIFT[0], -deep / 2 + SHADOW_SHIFT[1], across, deep])
  rounded(
    g,
    { x: -across / 2, y: -deep / 2 - LIFT, w: across, h: deep },
    {
      r: Math.min(across, deep) * spec.round,
      c: toneOf(art, car.body),
    }
  )
  fill(g, toneOf(art, TONES.glass), [cabin.x, cabin.y + cabin.h, cabin.w, GLASS_H])

  if (isSide) {
    paintRoof(g, { cabin, dir, rake: spec.rake, colour: roof })
  } else {
    rounded(g, cabin, { r: Math.min(w, h) * (spec.round > 0.3 ? 0.34 : 0.24), c: roof })
  }

  if (art.detail > 0) {
    paintTrim(art, { car, cabin, spec })
  }

  if (art.detail === 2 && isSide) {
    paintCloseSide(art, { car, cabin, spec })
  }

  return cabin
}

// A roof from above, narrowing towards the windscreen at the front and the tailgate at the rear.
function paintRoof(
  g: CanvasRenderingContext2D,
  roof: {
    readonly cabin: Cabin
    readonly dir: 1 | -1
    readonly rake: readonly [number, number]
    readonly colour: string
  }
): void {
  const { cabin, dir } = roof
  const front = roof.rake[0] * cabin.h
  const rear = roof.rake[1] * cabin.h
  const half = cabin.w / 2
  const mid = cabin.x + half
  const points = [
    [-half + rear * 0.8, 0],
    [half - front * 1.6, 0],
    [half, front],
    [half, cabin.h - front],
    [half - front * 1.6, cabin.h],
    [-half + rear * 0.8, cabin.h],
    [-half, cabin.h - rear],
    [-half, rear],
  ] as const

  g.fillStyle = roof.colour
  g.strokeStyle = roof.colour
  g.lineWidth = 0.5
  g.lineJoin = 'round'
  g.beginPath()

  for (const [u, v] of points) {
    g.lineTo(mid + dir * u, cabin.y + v)
  }

  g.closePath()
  g.fill()
  g.stroke()
}

// Pillars and a glint on the glass, then the wheels, arches and lamps from the side, or the
// face end on.
function paintTrim(
  art: Art,
  at: {
    readonly car: { readonly shape: Shape; readonly body: string }
    readonly cabin: Cabin
    readonly spec: CarSpec
  }
): void {
  const { g } = art
  const { cabin, spec } = at
  const { across, deep, dir, isSide } = at.car.shape
  const foot = deep / 2 - LIFT

  g.fillStyle = toneOf(art, at.car.body)

  for (const share of isSide ? [0.34, 0.64] : [0.46]) {
    g.fillRect(cabin.x + cabin.w * share, cabin.y + cabin.h, 0.34, GLASS_H)
  }

  fill(g, TONES.glint, [
    cabin.x + 0.3,
    cabin.y + cabin.h + 0.12,
    cabin.w * (isSide ? 0.28 : 0.4),
    0.34,
  ])

  if (!isSide) {
    paintFace(art, { across, foot, dir, body: at.car.body })
    return
  }

  paintSideWheels(art, { across, foot, spec })
  fill(g, toneOf(art, dir > 0 ? TONES.head : TONES.headSide), [
    dir * (across / 2 - 0.6) - 0.3,
    -0.5,
    0.6,
    0.9,
  ])
  fill(g, toneOf(art, TONES.tail), [-dir * (across / 2 - 0.6) - 0.3, -0.5, 0.6, 0.9])
}

// Wheel arches, the sill strip and the wheels from the side.
function paintSideWheels(
  art: Art,
  at: { readonly across: number; readonly foot: number; readonly spec: CarSpec }
): void {
  const { g } = art
  const { across, foot, spec } = at
  const wheelX = across * spec.wheelAt

  g.fillStyle = toneOf(art, TONES.arch)

  for (const x of [-wheelX, wheelX]) {
    g.beginPath()
    g.arc(x, foot - 0.15, spec.wheelR + 0.3, Math.PI, Math.PI * 2)
    g.fill()
  }

  g.fillRect(-wheelX, foot - 0.4, wheelX * 2, 0.4)

  if (spec.hasSill) {
    fill(g, toneOf(art, TONES.chrome), [-across * 0.21, foot - 0.62, across * 0.42, 0.14])
  }

  g.fillStyle = toneOf(art, TONES.wheel)

  for (const x of [-wheelX, wheelX]) {
    g.beginPath()
    g.arc(x, foot - 0.15, spec.wheelR, 0, Math.PI * 2)
    g.fill()
  }
}

// The front or rear face of a car end on, under the hood line: lamps, the chrome bar, grille,
// bumper corners, and the plate close up.
function paintFace(
  art: Art,
  at: {
    readonly across: number
    readonly foot: number
    readonly dir: 1 | -1
    readonly body: string
  }
): void {
  const { g } = art
  const { across, dir } = at
  const top = at.foot - 0.4
  const faceH = 1.5

  fill(g, toneOf(art, mixTone(at.body, TONES.lip, 0.14)), [
    -across / 2 + 0.15,
    top,
    across - 0.3,
    faceH,
  ])
  fill(g, toneOf(art, TONES.grille), [
    -across / 2 + 0.15,
    top + faceH * 0.58,
    across - 0.3,
    faceH * 0.42,
  ])

  if (dir > 0) {
    fill(g, toneOf(art, TONES.head), [-across * 0.34 - 0.5, top + 0.12, 1.05, 0.5])
    fill(g, toneOf(art, TONES.head), [across * 0.34 - 0.55, top + 0.12, 1.05, 0.5])
    fill(g, toneOf(art, TONES.chrome), [-across * 0.3, top + 0.34, across * 0.6, 0.16])
  } else {
    fill(g, toneOf(art, TONES.tail), [-across * 0.36 - 0.5, top + 0.12, 1, 0.45])
    fill(g, toneOf(art, TONES.tail), [across * 0.36 - 0.5, top + 0.12, 1, 0.45])
  }

  if (art.detail === 2) {
    fill(g, toneOf(art, TONES.plate), [-0.7, dir > 0 ? top + faceH - 0.55 : top + 0.62, 1.4, 0.4])
  }

  fill(g, toneOf(art, TONES.bumper), [-across / 2 + 0.1, top + faceH - 0.1, 0.9, 1])
  fill(g, toneOf(art, TONES.bumper), [across / 2 - 1, top + faceH - 0.1, 0.9, 1])
}

// Door seams, handles and the mirror, the rims and the nose strip, seen from the side close up.
function paintCloseSide(
  art: Art,
  at: {
    readonly car: { readonly shape: Shape; readonly body: string }
    readonly cabin: Cabin
    readonly spec: CarSpec
  }
): void {
  const { g } = art
  const { cabin, spec } = at
  const { across, deep, dir } = at.car.shape
  const foot = deep / 2 - LIFT
  const sill = cabin.y + cabin.h + GLASS_H
  const wheelX = across * spec.wheelAt

  fill(g, TONES.seam, [-1.4, sill, 0.08, foot - sill])
  fill(g, TONES.seam, [1.5, sill, 0.08, foot - sill])
  fill(g, toneOf(art, TONES.handle), [-0.6, sill + 0.12, 0.5, 0.14])
  fill(g, toneOf(art, TONES.handle), [2.1, sill + 0.12, 0.5, 0.14])
  fill(g, toneOf(art, at.car.body), [(dir * cabin.w) / 2 - 0.2, cabin.y + cabin.h - 0.1, 0.6, 0.5])

  for (const x of [-wheelX, wheelX]) {
    paintRim(art, { x, y: foot - 0.15, r: spec.wheelR, hasAlloys: spec.hasAlloys })
  }

  fill(g, toneOf(art, TONES.chrome), [
    dir * (across / 2 - 0.28) - 0.14,
    -deep / 2 + 0.3,
    0.28,
    deep - 1.8,
  ])
}

function paintRim(
  art: Art,
  rim: { readonly x: number; readonly y: number; readonly r: number; readonly hasAlloys: boolean }
): void {
  const { g } = art
  const { x, y, r } = rim

  if (rim.hasAlloys) {
    g.fillStyle = toneOf(art, TONES.rim)
    g.beginPath()
    g.arc(x, y, r * 0.66, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = toneOf(art, TONES.spoke)
    g.lineWidth = 0.1
    g.beginPath()

    for (let spoke = 0; spoke < 5; spoke++) {
      g.moveTo(x, y)
      g.lineTo(x + Math.cos(spoke * 1.2566) * r * 0.66, y + Math.sin(spoke * 1.2566) * r * 0.66)
    }

    g.stroke()
  }

  g.fillStyle = toneOf(art, TONES.hub)
  g.beginPath()
  g.arc(x, y, r * 0.2, 0, Math.PI * 2)
  g.fill()
}

function rounded(
  g: CanvasRenderingContext2D,
  rect: Cabin,
  pen: { readonly r: number; readonly c: string }
): void {
  g.fillStyle = pen.c
  g.beginPath()
  g.roundRect(rect.x, rect.y, rect.w, rect.h, pen.r)
  g.fill()
}

function paintTaxiSign(art: Art, at: { readonly x: number; readonly y: number }): void {
  const { g } = art

  fill(g, toneOf(art, TAXI_SIGN.tone), [
    at.x - TAXI_SIGN.w / 2,
    at.y - TAXI_SIGN.h / 2,
    TAXI_SIGN.w,
    TAXI_SIGN.h,
  ])

  if (art.detail === 2) {
    paintLabel(g, tr(art.pack.words.taxi), {
      x: at.x,
      y: at.y,
      size: TAXI_SIGN.word,
      colour: TAXI_SIGN.ink,
      maxW: TAXI_SIGN.w,
    })
  }
}
