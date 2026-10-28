import type { MovingScene, PaintPart, StreetMinute } from '@/web/scene/render2d/street/paint'
import type { Point } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import { lateStallOf } from '@/web/scene/render2d/street/shops'
import { mixTone, NIGHT_TONE } from '@/web/scene/render2d/street/tone'
import { sheltersOf } from '@/web/scene/sim/street/flows'
import { STREET_RECT } from '@/web/scene/view'
import { isLateNight, shopSpansOf } from '@/web/scene/world/frontage'
import { isShopOpen } from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { NORTH } from '@/web/scene/world/street-layout'
import { reducedMotion } from '@/web/state/prefs'

const MAX_DROPS = 420
const PUDDLES = Object.freeze({ far: 14, road: 8, rx: [2, 4], ry: [0.4, 0.5], beatMs: [800, 700] })
const WET = Object.freeze({
  dayVeil: '70,84,104',
  dayVeilAlpha: 0.17,
  nightVeil: 'rgba(14,20,38,.12)',
  nightFrom: 0.55,
  road: '46,64,96',
  roadAlpha: 0.17,
  roadNight: 0.07,
  reflectFrom: 0.25,
})
const REFLECT = Object.freeze({
  shop: { rgb: '255,214,130', alpha: 0.46, w: 15 },
  shelter: { rgb: '200,240,255', alpha: 0.3, w: 5, dx: 9.7 },
})
// Falling rain: a drizzle a few short pale lines, a downpour long fast sheets, slanting a little.
const DROP = Object.freeze({
  fallPx: 48,
  fallSpan: 78,
  length: 1.6,
  lengthSpan: 4.4,
  slant: 0.2,
  widthPx: 1.25,
})
// The far pass and the near one: their tone, alpha at no rain, and what rain adds.
const DROP_PASSES = [
  { tone: 'rgb(188,206,228)', alpha: 0.22, width: 0.75 },
  { tone: 'rgb(214,228,244)', alpha: 0.4, width: 1 },
] as const
const STILL_RAIN = '214,228,244'
const RING_TONE = 'rgb(236,244,252)'
const TARP = ['#3F7FC5', '#F2EFE6', '#D8453B', '#F2EFE6'] as const
const TARP_DEPTH = 3
const COVER = '#3F7FC5'
// Tarps and covers darken this share of the way to night.
const COVER_NIGHT = 0.4
const FOG = Object.freeze({ day: '#DDE3E9', night: '#2A3046', far: [0.94, 0.76, 0.46], near: 0.1 })

/** One puddle: its middle, radii, and the phase and beat of the rings a drop sends over it. */
interface Puddle {
  readonly x: number
  readonly y: number
  readonly rx: number
  readonly ry: number
  readonly phase: number
  readonly beatMs: number
}

const PUDDLE_LIST = buildPuddles()
// Every drop's own place, speed and pass, fixed once.
const DROPS = buildDrops()

/** The weather on the street: in the rain a wet road with puddles, its night reflections, tarps
 *  over the open cafés and a sheet over the late stall, and falling rain with rings in the
 *  puddles; in fog the far rows fade into a haze. */
export const WEATHER_PART: PaintPart = {
  paintStatic: (g, pack, minute) => {
    const { rain, fog } = minute.weather

    if (rain > 0) {
      paintWet(g, minute)
      paintReflections(g, { pack, minute })
      paintTarps(g, { pack, minute })

      if (reducedMotion.value) {
        paintStillRain(g, rain)
      }
    }

    if (fog) {
      paintFog(g, minute.light.dark)
    }
  },
  paintMoving: (g, view, scene) => {
    if (view.weather.falling > 0) {
      paintRain(g, { rain: view.weather.falling, t: view.weather.atMs, scene })
    }
  },
}

function paintWet(g: CanvasRenderingContext2D, minute: StreetMinute): void {
  const dark = minute.light.dark

  g.fillStyle =
    dark > WET.nightFrom
      ? WET.nightVeil
      : `rgba(${WET.dayVeil},${WET.dayVeilAlpha * (1 - dark * 0.6)})`
  g.fillRect(STREET_RECT.x, STREET_RECT.y, STREET_RECT.w, STREET_RECT.h)
  g.fillStyle = `rgba(${WET.road},${WET.roadAlpha + WET.roadNight * dark})`
  g.fillRect(STREET_RECT.x, NORTH.roadTop, STREET_RECT.w, NORTH.roadBottom - NORTH.roadTop)

  for (const puddle of PUDDLE_LIST) {
    g.globalAlpha = 0.34
    g.fillStyle = minute.light.sky[1]
    g.beginPath()
    g.ellipse(puddle.x, puddle.y, puddle.rx, puddle.ry, 0, 0, Math.PI * 2)
    g.fill()
  }

  g.globalAlpha = 1
}

// After dusk the lit shop fronts and shelter boxes lie in long streaks on the wet road.
function paintReflections(
  g: CanvasRenderingContext2D,
  at: { readonly pack: RegionPack; readonly minute: StreetMinute }
): void {
  const dark = at.minute.light.dark

  if (dark < WET.reflectFrom) {
    return
  }

  for (const span of shopSpansOf(at.pack.shops)) {
    if (span.row.kind !== 'lobby' && isShopOpen(span.row, at.minute.clock)) {
      streak(g, { x: span.x + span.w / 2, ...REFLECT.shop, alpha: REFLECT.shop.alpha * dark })
    }
  }

  for (const shelter of sheltersOf(at.pack)) {
    if (shelter.stop.side === 'far') {
      streak(g, {
        x: shelter.x + REFLECT.shelter.dx,
        ...REFLECT.shelter,
        alpha: REFLECT.shelter.alpha * dark,
      })
    }
  }
}

function streak(
  g: CanvasRenderingContext2D,
  at: { readonly x: number; readonly w: number; readonly rgb: string; readonly alpha: number }
): void {
  const top = NORTH.roadTop + 0.4
  const bottom = NORTH.roadBottom - 0.4
  const gradient = g.createLinearGradient(0, top, 0, bottom)

  gradient.addColorStop(0, `rgba(${at.rgb},${at.alpha})`)
  gradient.addColorStop(1, `rgba(${at.rgb},0)`)
  g.fillStyle = gradient
  g.fillRect(at.x - at.w / 2, top, at.w, bottom - top)
}

// A striped tarp out over each open café's seats, and a sheet thrown over the late stall.
function paintTarps(
  g: CanvasRenderingContext2D,
  at: { readonly pack: RegionPack; readonly minute: StreetMinute }
): void {
  const shade = at.minute.light.dark * COVER_NIGHT

  for (const span of shopSpansOf(at.pack.shops)) {
    if (span.row.kind === 'cafe' && isShopOpen(span.row, at.minute.clock)) {
      const stripes = Math.max(2, Math.round(span.w / 1.7))
      const stripeW = span.w / stripes

      for (let index = 0; index < stripes; index++) {
        g.fillStyle = mixTone(TARP[index % TARP.length] ?? COVER, NIGHT_TONE, shade)
        g.fillRect(span.x + index * stripeW, NORTH.farTop, stripeW + 0.05, TARP_DEPTH)
      }

      g.fillStyle = 'rgba(0,0,0,.18)'
      g.fillRect(span.x, NORTH.farTop + TARP_DEPTH, span.w, 0.6)
    }
  }

  const stall = isLateNight(at.pack, at.minute.clock) ? lateStallOf(at.pack) : undefined

  if (stall !== undefined) {
    paintCartCover(g, { at: stall, w: 4.6, h: 7.4, dark: at.minute.light.dark })
  }
}

/** A plastic sheet thrown over a cart `w` either side of its middle and `h` tall, in the rain. */
export function paintCartCover(
  g: CanvasRenderingContext2D,
  cart: { readonly at: Point; readonly w: number; readonly h: number; readonly dark: number }
): void {
  const { at, w, h } = cart

  g.fillStyle = mixTone(COVER, NIGHT_TONE, cart.dark * COVER_NIGHT)
  g.beginPath()
  g.moveTo(at.x - w, at.y)
  g.quadraticCurveTo(at.x - w * 0.95, at.y - h * 0.95, at.x, at.y - h)
  g.quadraticCurveTo(at.x + w * 0.95, at.y - h * 0.95, at.x + w, at.y)
  g.closePath()
  g.fill()
}

// Under reduced motion the rain is painted once, as pale slanted dashes.
function paintStillRain(g: CanvasRenderingContext2D, rain: number): void {
  const rng = createRng(seedOf('still-rain'))
  const count = Math.round(MAX_DROPS * Math.min(1, 0.1 + rain))
  const length = DROP.length + DROP.lengthSpan * rain

  g.strokeStyle = `rgba(${STILL_RAIN},${0.4 + 0.3 * rain})`
  g.lineWidth = 0.55
  g.lineCap = 'round'
  g.beginPath()

  for (let index = 0; index < count; index++) {
    const x = STREET_RECT.x + rng.next() * STREET_RECT.w
    const y = STREET_RECT.y + rng.next() * (NORTH.roadBottom - STREET_RECT.y)

    g.moveTo(x, y)
    g.lineTo(x - length * DROP.slant, y + length)
  }

  g.stroke()
}

function paintRain(
  g: CanvasRenderingContext2D,
  at: { readonly rain: number; readonly t: number; readonly scene: MovingScene }
): void {
  const { rect, px } = at.scene
  const count = Math.round(MAX_DROPS * Math.min(1, 0.1 + at.rain))
  const length = DROP.length + DROP.lengthSpan * at.rain
  const fall = DROP.fallPx + DROP.fallSpan * at.rain
  const seconds = at.t / 1000

  g.lineCap = 'round'

  for (let pass = 0; pass < DROP_PASSES.length; pass++) {
    const look = DROP_PASSES[pass] ?? DROP_PASSES[0]

    g.strokeStyle = look.tone
    g.globalAlpha = look.alpha + 0.2 * at.rain
    g.lineWidth = (DROP.widthPx / px) * look.width
    g.beginPath()

    for (let index = 0; index < count; index++) {
      const drop = index * 4

      if (((DROPS[drop + 3] ?? 0) < 0.5 ? 0 : 1) === pass) {
        const speed = fall * (0.75 + (DROPS[drop + 2] ?? 0) * 0.5)
        const y = rect.y + (((DROPS[drop + 1] ?? 0) * rect.h + seconds * speed) % rect.h)
        const sway = (y - rect.y) * DROP.slant
        const x = rect.x + (((((DROPS[drop] ?? 0) * rect.w - sway) % rect.w) + rect.w) % rect.w)

        g.moveTo(x, y)
        g.lineTo(x - length * DROP.slant, y + length)
      }
    }

    g.stroke()
  }

  g.globalAlpha = 1
  paintRings(g, at)
}

// One ring per puddle on its own beat; the harder the rain, the more puddles ring.
function paintRings(
  g: CanvasRenderingContext2D,
  at: { readonly rain: number; readonly t: number; readonly scene: MovingScene }
): void {
  const { rect, px } = at.scene

  const ringing = Math.min(
    PUDDLE_LIST.length,
    Math.ceil((at.rain * 1.1 + 0.12) * PUDDLE_LIST.length)
  )

  g.lineWidth = Math.max(0.14, 0.7 / px)
  g.strokeStyle = RING_TONE

  for (let index = 0; index < ringing; index++) {
    const puddle = PUDDLE_LIST[index]

    if (puddle !== undefined && puddle.x >= rect.x && puddle.x <= rect.x + rect.w) {
      const u = (at.t / puddle.beatMs + puddle.phase) % 1

      g.globalAlpha = 0.5 * (1 - u)
      g.beginPath()
      g.ellipse(
        puddle.x,
        puddle.y,
        0.5 + puddle.rx * 0.75 * u,
        0.12 + puddle.ry * 0.9 * u,
        0,
        0,
        Math.PI * 2
      )
      g.stroke()
    }
  }

  g.globalAlpha = 1
}

// The far rows and the sky fade into a pale haze, densest high up; a thin veil over the street.
function paintFog(g: CanvasRenderingContext2D, dark: number): void {
  const tone = mixTone(FOG.day, FOG.night, Math.min(1, dark * 0.85))
  const rgb = [1, 3, 5].map((at) => Number.parseInt(tone.slice(at, at + 2), 16)).join(',')
  const bottom = NORTH.farTop - 1
  const far = g.createLinearGradient(0, STREET_RECT.y, 0, bottom)

  far.addColorStop(0, `rgba(${rgb},${FOG.far[0]})`)
  far.addColorStop(0.55, `rgba(${rgb},${FOG.far[1]})`)
  far.addColorStop(1, `rgba(${rgb},${FOG.far[2]})`)
  g.fillStyle = far
  g.fillRect(STREET_RECT.x, STREET_RECT.y, STREET_RECT.w, bottom - STREET_RECT.y)
  g.fillStyle = `rgba(${rgb},${FOG.near})`
  g.fillRect(STREET_RECT.x, STREET_RECT.y, STREET_RECT.w, STREET_RECT.h)
}

function buildPuddles(): readonly Puddle[] {
  const rng = createRng(seedOf('puddles'))
  const span = (range: readonly number[]): number =>
    (range[0] ?? 0) + rng.next() * ((range[1] ?? 0) - (range[0] ?? 0))
  const puddles: Puddle[] = []

  for (let index = 0; index < PUDDLES.far + PUDDLES.road; index++) {
    const isFar = index < PUDDLES.far
    const x = STREET_RECT.x + rng.next() * STREET_RECT.w
    const y = isFar
      ? NORTH.farTop + 1.5 + rng.next() * (NORTH.roadTop - NORTH.farTop - 2.5)
      : NORTH.roadTop + 1 + rng.next() * (NORTH.roadBottom - NORTH.roadTop - 2)
    const phase = rng.next()

    puddles.push({
      x,
      y,
      rx: span(PUDDLES.rx),
      ry: span(PUDDLES.ry),
      phase,
      beatMs: (PUDDLES.beatMs[0] ?? 0) + Math.floor(phase * (PUDDLES.beatMs[1] ?? 0)),
    })
  }

  return puddles
}

function buildDrops(): Float32Array {
  const rng = createRng(seedOf('rain-drops'))
  const out = new Float32Array(MAX_DROPS * 4)

  for (let index = 0; index < out.length; index++) {
    out[index] = rng.next()
  }

  return out
}
