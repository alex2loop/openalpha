import type { PaintPart, StreetMinute } from '@/web/scene/render2d/street/paint'
import { paintLabel } from '@/web/scene/render2d/street/label'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { type Shelter, sheltersOf } from '@/web/scene/sim/street/flows'
import { HEIGHT_K } from '@/web/scene/view'
import { NORTH } from '@/web/scene/world/street-layout'
import { tr } from '@/web/text/tr'

// A shelter's foot on the far pavement by the kerb, or on the near one.
const FAR_Y = NORTH.roadTop - 3.6
const NEAR_Y = NORTH.roadBottom + 1.7
const ROOF_RISE = 9.5 * HEIGHT_K
const NIGHT_SHARE = 0.6
// The ad box lights after dusk.
const LIT_FROM_DARK = 0.25
const LIT_GLOW_ALPHA = 0.5
const TONES = Object.freeze({
  shadow: 'rgba(0,0,0,.14)',
  glass: '#7FA0BE',
  post: '#8A93A6',
  roof: '#CFE3F0',
  rim: '#5E8DBF',
  bench: '#9B7A52',
  benchBack: '#7A5C3C',
  adFrame: '#4A5262',
  adGlow: '255,236,190',
  plate: '#2F6FB5',
  plateLit: '#FFE9A0',
  plateDay: '#F6FAFF',
  ink: '#FFFFFF',
  stopInk: '#2A3E5C',
  signBlue: '#2A62B0',
  signWhite: '#F4F1E8',
})
// Plain ad panels, one pair of colours per shelter: the band and the ground.
const AD_TONES = [
  ['#E4572E', '#FFE9DE'],
  ['#2E86AB', '#E6F4FA'],
  ['#4CAF73', '#E8F6EC'],
  ['#8E5BB5', '#F1E8F8'],
  ['#D9A021', '#FBF1D6'],
] as const
// The shelter's parts from its foot, back to front: x, y, w, h, and how opaque.
const SHELTER_PARTS: readonly ShelterPart[] = [
  { tone: 'glass', rect: [-12, -ROOF_RISE + 0.6, 18, ROOF_RISE - 0.4], alpha: 0.4 },
  { tone: 'post', rect: [-12.4, -ROOF_RISE, 0.5, ROOF_RISE + 1.8] },
  { tone: 'post', rect: [5.9, -ROOF_RISE, 0.5, ROOF_RISE + 1.8] },
  { tone: 'roof', rect: [-13.4, -ROOF_RISE - 1.8, 20.6, 2.2], alpha: 0.7 },
  { tone: 'rim', rect: [-13.4, -ROOF_RISE + 0.2, 20.6, 0.4] },
  { tone: 'bench', rect: [-9, -2.4, 10, 0.8] },
  { tone: 'benchBack', rect: [-9, -4.1, 10, 0.5] },
  { tone: 'post', rect: [-13.7, -ROOF_RISE - 4.6, 0.4, ROOF_RISE + 6.4] },
  { tone: 'plate', rect: [-15.4, -ROOF_RISE - 5.6, 3.9, 4.2] },
]
const SHADOW_RECT = [-13, 0, 26, 3.2] as const
const PLATE_LIGHT = [-15, -ROOF_RISE - 5.2, 3.1, 0.9] as const
// Where the lettering sits from the foot: the two routes on the plate, the stop along the roof.
const ROUTE_TEXT = Object.freeze({
  x: -13.5,
  y: [-ROOF_RISE - 3.4, -ROOF_RISE - 2.2],
  size: 1.1,
  maxW: 3.4,
})
const STOP_TEXT = Object.freeze({ x: -3.2, y: -ROOF_RISE - 0.8, size: 1.05, maxW: 19 })
const AD = Object.freeze({ x: 7.4, w: 4.6, glow: 2 })
const BUS_SIGN_X = 16.5
const BUS_SIGN_POLE = 3.6

/** The bus shelters along the north street, each with its stop's name, its two routes, an ad box
 *  lit at night, and the bus-stop sign beside it. Their waiters are the pedestrians'. */
export const SHELTERS_PART: PaintPart = {
  paintStatic: (g, pack, minute) => {
    const dark = minute.light.dark

    for (const [index, shelter] of sheltersOf(pack).entries()) {
      const at = { x: shelter.x, y: shelter.stop.side === 'far' ? FAR_Y : NEAR_Y }

      paintShelter(g, { shelter, at, dark, index, minute })
      paintBusSign(g, { x: at.x + BUS_SIGN_X, y: at.y, dark, minute })
    }
  },
}

type ShelterTone = 'glass' | 'post' | 'roof' | 'rim' | 'bench' | 'benchBack' | 'plate'

interface ShelterPart {
  readonly tone: ShelterTone
  readonly rect: readonly [number, number, number, number]
  readonly alpha?: number
}

interface ShelterPaint {
  readonly shelter: Shelter
  readonly at: { readonly x: number; readonly y: number }
  readonly dark: number
  readonly index: number
  readonly minute: StreetMinute
}

function paintShelter(g: CanvasRenderingContext2D, paint: ShelterPaint): void {
  const { x, y } = paint.at
  const tone = (hex: string): string => mixTone(hex, NIGHT_TONE, paint.dark * NIGHT_SHARE)

  g.fillStyle = TONES.shadow
  g.fillRect(x + SHADOW_RECT[0], y + SHADOW_RECT[1], SHADOW_RECT[2], SHADOW_RECT[3])

  for (const part of SHELTER_PARTS) {
    g.globalAlpha = part.alpha ?? 1
    g.fillStyle = tone(TONES[part.tone])
    g.fillRect(x + part.rect[0], y + part.rect[1], part.rect[2], part.rect[3])
  }

  g.globalAlpha = 1
  g.fillStyle = paint.dark > LIT_FROM_DARK ? TONES.plateLit : tone(TONES.plateDay)
  g.fillRect(x + PLATE_LIGHT[0], y + PLATE_LIGHT[1], PLATE_LIGHT[2], PLATE_LIGHT[3])
  paintAd(g, paint)
  paintNames(g, { ...paint, tone })
}

// The ad panel at the open end: a light box after dusk.
function paintAd(g: CanvasRenderingContext2D, paint: ShelterPaint): void {
  const [band, ground] = AD_TONES[paint.index % AD_TONES.length] ?? AD_TONES[0]
  const isLit = paint.dark > LIT_FROM_DARK
  const x = paint.at.x + AD.x
  const top = paint.at.y - ROOF_RISE + 0.4
  const h = ROOF_RISE - 1.2
  const tone = (hex: string): string =>
    isLit ? hex : mixTone(hex, NIGHT_TONE, paint.dark * NIGHT_SHARE)

  g.fillStyle = tone(TONES.adFrame)
  g.fillRect(x - 0.4, top - 0.4, AD.w + 0.8, h + 0.8)

  if (isLit) {
    g.fillStyle = `rgba(${TONES.adGlow},${Math.min(LIT_GLOW_ALPHA, paint.dark)})`
    g.fillRect(x - AD.glow, top - AD.glow / 2, AD.w + AD.glow * 2, h + AD.glow)
  }

  g.fillStyle = tone(ground)
  g.fillRect(x, top, AD.w, h)
  g.fillStyle = tone(band)
  g.fillRect(x, top, AD.w, h * 0.45)
  g.fillRect(x + 0.6, top + h * 0.62, AD.w - 1.2, 0.6)
}

// The two routes on the plate and the stop's name along the roof, from the middle detail up.
function paintNames(
  g: CanvasRenderingContext2D,
  paint: ShelterPaint & { readonly tone: (hex: string) => string }
): void {
  const { x, y } = paint.at
  const { stop } = paint.shelter

  if (paint.minute.detail === 0) {
    return
  }

  for (const [index, route] of stop.routes.entries()) {
    paintLabel(g, route, {
      x: x + ROUTE_TEXT.x,
      y: y + (ROUTE_TEXT.y[index] ?? 0),
      size: ROUTE_TEXT.size,
      colour: TONES.ink,
      maxW: ROUTE_TEXT.maxW,
    })
  }

  paintLabel(g, stop.name, {
    x: x + STOP_TEXT.x,
    y: y + STOP_TEXT.y,
    size: STOP_TEXT.size,
    colour: paint.tone(TONES.stopInk),
    maxW: STOP_TEXT.maxW,
  })
}

// The blue bus-stop plate: a bus from the side, and the stop word close up.
function paintBusSign(
  g: CanvasRenderingContext2D,
  at: {
    readonly x: number
    readonly y: number
    readonly dark: number
    readonly minute: StreetMinute
  }
): void {
  const { x } = at
  const tone = (hex: string): string => mixTone(hex, NIGHT_TONE, at.dark * NIGHT_SHARE)
  const top = at.y - BUS_SIGN_POLE
  const cy = top - 1.2

  g.fillStyle = tone(TONES.post)
  g.fillRect(x - 0.28, top, 0.56, BUS_SIGN_POLE)
  g.fillStyle = tone(TONES.signBlue)
  g.fillRect(x - 1, cy - 1.2, 2, 2.4)

  if (at.minute.detail === 0) {
    return
  }

  g.fillStyle = tone(TONES.signWhite)
  g.fillRect(x - 0.6, cy - 0.55, 1.2, 0.85)
  g.fillRect(x - 0.5, cy + 0.4, 0.3, 0.25)
  g.fillRect(x + 0.2, cy + 0.4, 0.3, 0.25)
  g.fillStyle = tone(TONES.signBlue)
  g.fillRect(x - 0.45, cy - 0.4, 0.9, 0.3)

  if (at.minute.detail === 2) {
    paintLabel(g, tr('ui.office.street.busStop'), {
      x,
      y: cy - 1.8,
      size: 0.6,
      colour: tone(TONES.stopInk),
      maxW: 6,
    })
  }
}
