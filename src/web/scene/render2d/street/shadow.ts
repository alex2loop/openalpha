import type { StreetMinute } from '@/web/scene/render2d/street/paint'
import type { Point } from '@/web/scene/types'
import { DEG } from '@/web/scene/clock/sun'

// Shadows show once the sun is this high, full by twice that; never longer than this many
// heights; this dark under a clear sky. The sun is read in whole steps of SUN_STEP_DEG, so a
// shadow moves a few px every few minutes and a layer holding shadows keeps between them.
const RISE_DEG = 4
const MAX_LENGTH = 3
const SUN_STEP_DEG = 1
// The tallest thing that casts one, in world px.
const TALLEST_PX = 40
const ALPHA = 0.2
const SHADOW_RGB = '20,24,40'

/** How far from its foot a shadow reaches, in world px. */
export const SHADOW_REACH_PX = MAX_LENGTH * TALLEST_PX

/** A shadow's ground step per world px of height, away from the sun's bearing, its alpha and what
 *  it looks like as a key; none while the sun is down. */
interface Cast {
  readonly dx: number
  readonly dy: number
  readonly alpha: number
  readonly fill: string
  readonly key: string
}

const NONE: Cast = Object.freeze({ dx: 0, dy: 0, alpha: 0, fill: '', key: '' })
// The minute's cast, read once for every thing that throws one.
let castFor: StreetMinute | undefined
let cast: Cast = NONE

/** How shadows fall in `minute`: long in the morning and afternoon, short at noon, none at night,
 *  fainter under cloud. */
function castOf(minute: StreetMinute): Cast {
  if (minute === castFor) {
    return cast
  }

  const altitudeDeg = steppedDeg(minute.sun.altitudeDeg)
  const azimuthDeg = steppedDeg(minute.sun.azimuthDeg)
  const length = Math.min(MAX_LENGTH, 1 / Math.tan(altitudeDeg * DEG))
  const alpha =
    ALPHA *
    Math.min(1, Math.max(0, (altitudeDeg - RISE_DEG) / RISE_DEG)) *
    (1 - minute.weather.cloud)

  castFor = minute
  cast = alpha <= 0 ? NONE : castOfSun({ azimuthDeg, length, alpha })

  return cast
}

function castOfSun(sun: {
  readonly azimuthDeg: number
  readonly length: number
  readonly alpha: number
}): Cast {
  const dx = -Math.sin(sun.azimuthDeg * DEG) * sun.length
  const dy = Math.cos(sun.azimuthDeg * DEG) * sun.length
  const fill = `rgba(${SHADOW_RGB},${sun.alpha.toFixed(3)})`

  return { dx, dy, alpha: sun.alpha, fill, key: [dx, dy, fill].join() }
}

function steppedDeg(deg: number): number {
  return Math.round(deg / SUN_STEP_DEG) * SUN_STEP_DEG
}

/** What the shadows of `minute` look like, empty while none falls: equal keys, equal shadows. */
export function shadowKeyOf(minute: StreetMinute): string {
  return castOf(minute).key
}

/** The shadow of a thing `w` wide and `h` tall standing at `at`, on the ground. */
export function paintGroundShadow(
  g: CanvasRenderingContext2D,
  minute: StreetMinute,
  thing: { readonly at: Point; readonly w: number; readonly h: number }
): void {
  const { dx, dy, alpha, fill } = castOf(minute)

  if (alpha <= 0) {
    return
  }

  const half = thing.w / 2
  const tipX = dx * thing.h
  const tipY = dy * thing.h

  g.fillStyle = fill
  g.beginPath()
  g.moveTo(thing.at.x - half, thing.at.y)
  g.lineTo(thing.at.x + half, thing.at.y)
  g.lineTo(thing.at.x + half + tipX, thing.at.y + tipY)
  g.lineTo(thing.at.x - half + tipX, thing.at.y + tipY)
  g.closePath()
  g.fill()
}
