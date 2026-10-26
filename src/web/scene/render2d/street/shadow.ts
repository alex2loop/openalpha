import type { StreetMinute } from '@/web/scene/render2d/street/paint'
import type { Point } from '@/web/scene/types'

const DEG = Math.PI / 180
// Shadows show once the sun is this high, full by twice that; never longer than this many
// heights; this dark under a clear sky.
const RISE_DEG = 4
const MAX_LENGTH = 3
const ALPHA = 0.2
const SHADOW_RGB = '20,24,40'

/** A shadow's ground step per world px of height, away from the sun's bearing, and its alpha;
 *  none while the sun is down. */
interface Cast {
  readonly dx: number
  readonly dy: number
  readonly alpha: number
  readonly fill: string
}

const NONE: Cast = Object.freeze({ dx: 0, dy: 0, alpha: 0, fill: '' })
// The minute's cast, read once for every thing that throws one.
let castFor: StreetMinute | undefined
let cast: Cast = NONE

/** How shadows fall in `minute`: long in the morning and afternoon, short at noon, none at night,
 *  fainter under cloud. */
function castOf(minute: StreetMinute): Cast {
  if (minute === castFor) {
    return cast
  }

  const { altitudeDeg, azimuthDeg } = minute.sun
  const length = Math.min(MAX_LENGTH, 1 / Math.tan(altitudeDeg * DEG))
  const alpha =
    ALPHA *
    Math.min(1, Math.max(0, (altitudeDeg - RISE_DEG) / RISE_DEG)) *
    (1 - minute.weather.cloud)

  castFor = minute
  cast =
    alpha <= 0
      ? NONE
      : {
          dx: -Math.sin(azimuthDeg * DEG) * length,
          dy: Math.cos(azimuthDeg * DEG) * length,
          alpha,
          fill: `rgba(${SHADOW_RGB},${alpha.toFixed(3)})`,
        }

  return cast
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
