import type { StreetMinute } from '@/web/scene/render2d/street/paint'
import type { Point } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import { measureLabel, paintLabel } from '@/web/scene/render2d/street/label'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { CROSSING, KERB_Y, SIDE_ROAD, sideX } from '@/web/scene/world/street-layout'
import { tr } from '@/web/text/tr'

/** Where the street's furniture stands, on the far and the near kerb, and how much of the
 *  night's darkness it takes. */
export const FURNITURE = Object.freeze({
  farY: KERB_Y.far,
  nearY: KERB_Y.near,
  night: 0.5,
})
// Road signs: where they stand, and on which kerb.
const SIGN_POLE = { round: 4.6, square: 3.6 } as const
const SIGNS: readonly Sign[] = [
  { kind: 'speed', at: { x: 118, y: FURNITURE.farY }, limit: 'north' },
  { kind: 'speed', at: { x: 520, y: FURNITURE.farY }, limit: 'north' },
  { kind: 'speed', at: { x: sideX(-1, 12), y: 56 }, limit: 'side' },
  { kind: 'speed', at: { x: sideX(1, 12), y: 64 }, limit: 'side' },
  { kind: 'noParking', at: { x: 262, y: FURNITURE.farY } },
  { kind: 'noParking', at: { x: 494, y: FURNITURE.farY } },
  { kind: 'noParking', at: { x: 560, y: FURNITURE.nearY } },
  { kind: 'crosswalk', at: { x: CROSSING.x + 20, y: FURNITURE.farY } },
  { kind: 'crosswalk', at: { x: CROSSING.x - 6, y: FURNITURE.nearY } },
]
// The US limit plate: an upright white rectangle over the pole, its border inset, the two lines
// of words and the number, as offsets from the plate's centre with the lettering size and width.
const US_LIMIT = Object.freeze({
  lift: 1.7,
  w: 2.3,
  h: 3.2,
  inset: 0.13,
  border: 0.14,
  wordsY: [-1.05, -0.62],
  wordSize: 0.42,
  wordW: 1.8,
  numberY: 0.55,
  numberSize: 1.15,
  numberW: 1.7,
})
const TURN_PLATE = Object.freeze({ x: -1.3, y: -6.7, w: 2.6, h: 1.7 })
const SIGN_TONES = Object.freeze({
  metal: '#7C8190',
  red: '#D8453B',
  blue: '#2A62B0',
  white: '#F4F1E8',
  ink: '#1A1C22',
})
// The name plate: the mockup's size times `STREET_PLATE_SCALE`, its pole, the lettering sizes,
// where the main street's plates stand along the far kerb, and where a side street's stands: on
// its outer kerb, just south of the junction.
const STREET_PLATE_SCALE = 2
const PLATE = Object.freeze({ h: 5.8, pole: 8.6, word: 1.2, name: 2.6, pad: 2.4, inset: 0.4 })
const PLATE_X = [-60, 660] as const
const SIDE_PLATE = Object.freeze({ out: SIDE_ROAD.to + 6, y: 14 })

interface Sign {
  readonly kind: 'speed' | 'noParking' | 'crosswalk'
  readonly at: Point
  readonly limit?: 'north' | 'side'
}

/** The road signs (speed limits from the pack, no parking, crosswalks) and the name plates of the
 *  pack's main street and its two side streets. */
export function paintSigns(
  g: CanvasRenderingContext2D,
  at: { readonly pack: RegionPack; readonly minute: StreetMinute; readonly dark: number }
): void {
  for (const sign of SIGNS) {
    paintSign(g, { sign, ...at })
  }

  const { pack, dark } = at
  const plates = [
    ...PLATE_X.map((x) => ({ x, y: FURNITURE.farY, name: pack.street })),
    { x: sideX(-1, SIDE_PLATE.out), y: SIDE_PLATE.y, name: pack.sideStreets.west },
    { x: sideX(1, SIDE_PLATE.out), y: SIDE_PLATE.y, name: pack.sideStreets.east },
  ]

  for (const { name, ...point } of plates) {
    paintPlate(g, { at: point, name, pack, dark })
  }
}

function paintSign(
  g: CanvasRenderingContext2D,
  at: {
    readonly sign: Sign
    readonly pack: RegionPack
    readonly minute: StreetMinute
    readonly dark: number
  }
): void {
  const { sign, dark } = at
  const { x, y } = sign.at
  const tone = (hex: string): string => mixTone(hex, NIGHT_TONE, dark)
  const pole = sign.kind === 'crosswalk' ? SIGN_POLE.square : SIGN_POLE.round
  const top = y - pole

  g.fillStyle = tone(SIGN_TONES.metal)
  g.fillRect(x - 0.28, top, 0.56, pole)

  if (sign.kind === 'crosswalk') {
    paintCrosswalkSign(g, { x, y: top - 1.15, tone, detail: at.minute.detail })
    return
  }

  if (sign.kind === 'speed') {
    const limit = sign.limit === 'side' ? at.pack.speed.side : at.pack.speed.north

    paintSpeedLimit(g, {
      foot: { x, y: top },
      limit,
      unit: at.pack.speed.unit,
      tone,
      detail: at.minute.detail,
    })
    return
  }

  const cy = top - 1.05

  disc(g, { x, y: cy, r: 1.15, colour: tone(SIGN_TONES.blue) })
  g.strokeStyle = tone(SIGN_TONES.red)
  g.lineWidth = 0.28
  g.beginPath()
  g.arc(x, cy, 0.98, 0, Math.PI * 2)
  g.moveTo(x - 0.7, cy + 0.7)
  g.lineTo(x + 0.7, cy - 0.7)
  g.stroke()
}

// The limit sign on its pole: the European red-ringed disc, or the US plate where the limit is in
// mph.
function paintSpeedLimit(
  g: CanvasRenderingContext2D,
  at: {
    readonly foot: Point
    readonly limit: number
    readonly unit: RegionPack['speed']['unit']
    readonly tone: (hex: string) => string
    readonly detail: number
  }
): void {
  const { x, y } = at.foot
  const { tone } = at

  if (at.unit === 'mph') {
    paintUsLimit(g, { x, y: y - US_LIMIT.lift, limit: at.limit, tone, detail: at.detail })
    return
  }

  const cy = y - 1.05

  disc(g, { x, y: cy, r: 1.15, colour: tone(SIGN_TONES.red) })
  disc(g, { x, y: cy, r: 0.84, colour: tone(SIGN_TONES.white) })

  if (at.detail > 0) {
    paintLabel(g, String(at.limit), {
      x,
      y: cy + 0.06,
      size: 0.95,
      colour: tone(SIGN_TONES.ink),
      maxW: 1.5,
    })
  }
}

// The US speed limit: SPEED LIMIT over the number on a white plate with a black border. The
// catalog's words break in two at the space nearest their middle.
function paintUsLimit(
  g: CanvasRenderingContext2D,
  at: {
    readonly x: number
    readonly y: number
    readonly limit: number
    readonly tone: (hex: string) => string
    readonly detail: number
  }
): void {
  const { x, y, tone } = at
  const ink = tone(SIGN_TONES.ink)
  const inset = US_LIMIT.inset

  g.fillStyle = tone(SIGN_TONES.white)
  g.fillRect(x - US_LIMIT.w / 2, y - US_LIMIT.h / 2, US_LIMIT.w, US_LIMIT.h)
  g.strokeStyle = ink
  g.lineWidth = US_LIMIT.border
  g.strokeRect(
    x - US_LIMIT.w / 2 + inset,
    y - US_LIMIT.h / 2 + inset,
    US_LIMIT.w - inset * 2,
    US_LIMIT.h - inset * 2
  )

  if (at.detail === 0) {
    return
  }

  const words = twoLines(tr('ui.office.street.speedLimit'))

  for (const [index, line] of words.entries()) {
    paintLabel(g, line, {
      x,
      y: y + (US_LIMIT.wordsY[index] ?? 0),
      size: US_LIMIT.wordSize,
      colour: ink,
      maxW: US_LIMIT.wordW,
    })
  }

  paintLabel(g, String(at.limit), {
    x,
    y: y + US_LIMIT.numberY,
    size: US_LIMIT.numberSize,
    colour: ink,
    maxW: US_LIMIT.numberW,
  })
}

// The words split at the space nearest the middle: one line when there is none.
function twoLines(text: string): readonly string[] {
  const middle = text.length / 2
  const before = text.lastIndexOf(' ', middle)
  const after = text.indexOf(' ', middle)
  const isAfterNearer = before < 0 || (after >= 0 && after - middle < middle - before)
  const cut = isAfterNearer ? after : before

  return cut < 0 ? [text] : [text.slice(0, cut), text.slice(cut + 1)]
}

function paintCrosswalkSign(
  g: CanvasRenderingContext2D,
  at: {
    readonly x: number
    readonly y: number
    readonly tone: (hex: string) => string
    readonly detail: number
  }
): void {
  const { x, y, tone } = at

  g.fillStyle = tone(SIGN_TONES.blue)
  g.fillRect(x - 1.15, y - 1.15, 2.3, 2.3)

  if (at.detail === 0) {
    return
  }

  g.fillStyle = tone(SIGN_TONES.white)
  g.beginPath()
  g.moveTo(x, y - 0.95)
  g.lineTo(x + 0.95, y + 0.85)
  g.lineTo(x - 0.95, y + 0.85)
  g.closePath()
  g.fill()
  g.fillStyle = tone(SIGN_TONES.ink)
  disc(g, { x, y: y - 0.1, r: 0.17, colour: tone(SIGN_TONES.ink) })
  g.fillRect(x - 0.12, y + 0.05, 0.24, 0.4)
}

function disc(
  g: CanvasRenderingContext2D,
  at: { readonly x: number; readonly y: number; readonly r: number; readonly colour: string }
): void {
  g.fillStyle = at.colour
  g.beginPath()
  g.arc(at.x, at.y, at.r, 0, Math.PI * 2)
  g.fill()
}

// A street's name plate in the pack's style, the street word over the name, lettered at every
// detail level so it reads at the floor zoom.
function paintPlate(
  g: CanvasRenderingContext2D,
  at: {
    readonly at: Point
    readonly name: string
    readonly pack: RegionPack
    readonly dark: number
  }
): void {
  const { plate } = at.pack
  const scale = STREET_PLATE_SCALE
  const h = PLATE.h * scale
  const name = plate.caps ? at.name.toUpperCase() : at.name
  const ink = mixTone(plate.ink, NIGHT_TONE, at.dark)
  const { x } = at.at
  const pole = at.at.y - PLATE.pole
  const w = Math.max(
    measureLabel(g, name, PLATE.name * scale) + PLATE.pad * scale,
    (h * plate.ratio[0]) / plate.ratio[1]
  )
  const top = pole - h

  g.fillStyle = mixTone(SIGN_TONES.metal, NIGHT_TONE, at.dark)
  g.fillRect(x - 0.45, pole, 0.9, PLATE.pole)
  g.fillStyle = mixTone(plate.background, NIGHT_TONE, at.dark)
  g.fillRect(x - w / 2, top, w, h)

  if (plate.frame) {
    g.strokeStyle = ink
    g.lineWidth = 0.17 * scale
    g.strokeRect(
      x - w / 2 + PLATE.inset * scale,
      top + PLATE.inset * scale,
      w - PLATE.inset * 2 * scale,
      h - PLATE.inset * 2 * scale
    )
  }

  paintPlateWords(g, { pack: at.pack, name, ink, x, top, w })
}

// The street word over the name, or the name alone, in the plate's ink.
function paintPlateWords(
  g: CanvasRenderingContext2D,
  at: {
    readonly pack: RegionPack
    readonly name: string
    readonly ink: string
    readonly x: number
    readonly top: number
    readonly w: number
  }
): void {
  const { plate } = at.pack
  const scale = STREET_PLATE_SCALE
  const h = PLATE.h * scale
  const word = tr('ui.office.street.streetWord')
  const maxW = at.w - PLATE.pad * scale

  if (plate.streetWord) {
    paintLabel(g, plate.caps ? word.toUpperCase() : word, {
      x: at.x,
      y: at.top + h * 0.28,
      size: PLATE.word * scale,
      colour: at.ink,
      maxW,
    })
  }

  paintLabel(g, at.name, {
    x: at.x,
    y: plate.streetWord ? at.top + h * 0.64 : at.top + h / 2,
    size: PLATE.name * scale,
    colour: at.ink,
    maxW,
  })
}

// The blue plate that lets two-wheelers turn right on red: an arrow, no words.
export function paintTurnPlate(g: CanvasRenderingContext2D, at: Point, dark: number): void {
  const x = at.x + TURN_PLATE.x
  const y = at.y + TURN_PLATE.y

  g.fillStyle = mixTone(SIGN_TONES.blue, NIGHT_TONE, dark)
  g.fillRect(x, y, TURN_PLATE.w, TURN_PLATE.h)
  g.strokeStyle = mixTone(SIGN_TONES.white, NIGHT_TONE, dark)
  g.lineWidth = 0.16
  g.beginPath()
  g.moveTo(x + 0.6, y + 1.1)
  g.lineTo(x + 1.9, y + 1.1)
  g.lineTo(x + 1.9, y + 0.5)
  g.stroke()
}
