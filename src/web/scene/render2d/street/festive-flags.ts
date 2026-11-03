import type { Rect } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import { STREET_LEFT, STREET_RIGHT } from '@/web/scene/render2d/street/city-ground'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { sheltersOf } from '@/web/scene/sim/street/flows'
import { frontageOf, shopRowSpanOf } from '@/web/scene/world/frontage'
import { CROSSING, KERB_Y, NORTH } from '@/web/scene/world/street-layout'

const ROW_FLAG_PITCH = 25.2
const KERB_FLAG_PITCH = 54
const FLAG_CLEAR = Object.freeze({ shelter: 20, crossing: 14, row: 8 })
const ROW_FLAG_Y = NORTH.farTop - 0.2
// A big flag stands on each side of the frontage's top.
const FRONTAGE_FLAG = Object.freeze({ drop: 24, inset: 5, w: 11, h: 7 })
// A flag's pole: its colour, half its width (the cloth starts at its right edge), its height in
// flag heights and the night's share it takes; and the night's share the cloth takes.
const POLE = Object.freeze({ tone: '#8A6B3E', halfW: 0.18, rise: 2.2, night: 0.5 })
const CLOTH_NIGHT = 0.4
const US_FLAG = Object.freeze({
  red: '#B22234',
  white: '#F4F1E8',
  blue: '#3C3B6E',
  stripes: 7,
  cantonW: 0.42,
  cantonStripes: 4,
  starCols: 3,
  starRows: 2,
  starR: 0.07,
})

/** A flag on its pole: where its foot is, its cloth's size and how dark it is. */
interface Flag {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly dark: number
}

/** The flags of one national day: how dark it is and how a flag is painted. */
interface Flags {
  readonly dark: number
  readonly paint: (g: CanvasRenderingContext2D, flag: Flag) => void
}

/** Flags on the far kerb's poles, along the shop row and either side of the frontage's top. */
export function paintFlags(g: CanvasRenderingContext2D, pack: RegionPack, flags: Flags): void {
  const row = shopRowSpanOf(pack.shops)
  const stops = sheltersOf(pack).filter((shelter) => shelter.stop.side === 'far')
  const { dark, paint } = flags
  const isClear = (x: number): boolean =>
    (row === undefined || x <= row[0] - FLAG_CLEAR.row || x >= row[1] + FLAG_CLEAR.row) &&
    stops.every((shelter) => Math.abs(shelter.x - x) >= FLAG_CLEAR.shelter) &&
    Math.abs(x - CROSSING.x) >= FLAG_CLEAR.crossing

  for (
    let x = Math.ceil((STREET_LEFT + 10) / KERB_FLAG_PITCH) * KERB_FLAG_PITCH;
    x < STREET_RIGHT;
    x += KERB_FLAG_PITCH
  ) {
    if (isClear(x)) {
      paint(g, { x, y: KERB_Y.far + 0.1, w: 4.8, h: 3.1, dark })
    }
  }

  if (row !== undefined) {
    for (let x = row[0] + 10; x < row[1] - 8; x += ROW_FLAG_PITCH) {
      paint(g, { x, y: ROW_FLAG_Y, w: 3.6, h: 2.3, dark })
    }
  }

  paintFrontageFlags(g, frontageOf(pack.shops)?.body, flags)
}

function paintFrontageFlags(
  g: CanvasRenderingContext2D,
  body: Rect | undefined,
  flags: Flags
): void {
  if (body === undefined) {
    return
  }

  const { drop, inset, w, h } = FRONTAGE_FLAG
  const y = body.y + drop
  const { dark, paint } = flags

  paint(g, { x: body.x + inset, y, w, h, dark })
  paint(g, { x: body.x + body.w - inset - w, y, w, h, dark })
}

/** A flag on its pole: red field, yellow star. */
export function paintVnFlag(g: CanvasRenderingContext2D, flag: Flag): void {
  const { x, w, h, dark } = flag
  const top = paintPole(g, flag)

  g.fillStyle = mixTone('#DA251D', NIGHT_TONE, dark * CLOTH_NIGHT)
  g.fillRect(x + POLE.halfW, top, w, h)
  g.fillStyle = '#FFDE00'
  g.beginPath()

  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + i * (Math.PI / 5)
    const reach = i % 2 === 0 ? h * 0.42 : h * 0.2

    g.lineTo(
      x + POLE.halfW + w / 2 + Math.cos(angle) * reach,
      top + h / 2 + Math.sin(angle) * reach
    )
  }

  g.closePath()
  g.fill()
}

/** A flag on its pole: seven red and white stripes, a blue corner dotted with stars. */
export function paintUsFlag(g: CanvasRenderingContext2D, flag: Flag): void {
  const { w, h, dark } = flag
  const left = flag.x + POLE.halfW
  const top = paintPole(g, flag)
  const stripeH = h / US_FLAG.stripes
  const canton = { w: w * US_FLAG.cantonW, h: stripeH * US_FLAG.cantonStripes }

  for (let i = 0; i < US_FLAG.stripes; i++) {
    g.fillStyle = mixTone(i % 2 === 0 ? US_FLAG.red : US_FLAG.white, NIGHT_TONE, dark * CLOTH_NIGHT)
    g.fillRect(left, top + i * stripeH, w, stripeH + 0.02)
  }

  g.fillStyle = mixTone(US_FLAG.blue, NIGHT_TONE, dark * CLOTH_NIGHT)
  g.fillRect(left, top, canton.w, canton.h)
  g.fillStyle = US_FLAG.white

  for (let col = 1; col <= US_FLAG.starCols; col++) {
    for (let row = 1; row <= US_FLAG.starRows; row++) {
      g.beginPath()
      g.arc(
        left + (canton.w * col) / (US_FLAG.starCols + 1),
        top + (canton.h * row) / (US_FLAG.starRows + 1),
        h * US_FLAG.starR,
        0,
        Math.PI * 2
      )
      g.fill()
    }
  }
}

// The pole, tone shaded toward night; the y of its top, where the cloth starts.
function paintPole(g: CanvasRenderingContext2D, flag: Flag): number {
  const height = flag.h * POLE.rise
  const top = flag.y - height

  g.fillStyle = mixTone(POLE.tone, NIGHT_TONE, flag.dark * POLE.night)
  g.fillRect(flag.x - POLE.halfW, top, POLE.halfW * 2, height)

  return top
}
