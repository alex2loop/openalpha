import type { WeatherFxView } from '@/web/scene/sky-types'
import type { LightView, Rect } from '@/web/scene/types'
import { isMorningSun } from '@/web/scene/clock/sun'
import { type FloorId, WORLD } from '@/web/scene/types'
import { DOORS } from '@/web/scene/world/doors'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { WALL_BAND_PX } from '@/web/scene/world/rooms'

/** The north glass's pane in 2D: under the frame, down to the sill. */
export const NORTH_GLASS: Rect = Object.freeze({ x: 0, y: 4, w: WORLD.w, h: 24 })
/** Rain streaks step on at most this rate, a small motion. */
export const STREAK_FRAME_MS = 83
const MAX_STREAKS = 180
const STREAKS_PER_PX = 0.28
const STREAK = Object.freeze({
  speedPx: 9,
  speedSpan: 14,
  length: 2.2,
  lengthSpan: 4.5,
  width: 0.35,
})
const STREAK_RGB = '226,236,248'
const HAZE = Object.freeze({ rgb: '232,236,242', alpha: 0.42, untilAltitudeDeg: 25 })
const FLASH = Object.freeze({ ms: 260, alpha: 0.34 })
// West blinds close while the sun is low in the west of the afternoon sky under a broken cloud,
// fully at the horizon; they are open again once it sets.
const BLINDS = Object.freeze({
  fromAzimuthDeg: 200,
  untilAzimuthDeg: 340,
  belowAltitudeDeg: 32,
  setAltitudeDeg: -1,
  underCloud: 0.75,
})
// Every streak's own place, speed and length, fixed once.
const STREAKS = buildStreaks()
const BLIND_SPANS: Readonly<Record<FloorId, readonly (readonly [number, number])[]>> = {
  office: westSpansOf('office'),
  team: westSpansOf('team'),
}

/** How far the west blinds are drawn, 0 open to 1 closed. */
export function blindClosureOf(light: LightView): number {
  const { altitudeDeg, azimuthDeg } = light.sun
  const isWestLow =
    azimuthDeg > BLINDS.fromAzimuthDeg &&
    azimuthDeg < BLINDS.untilAzimuthDeg &&
    altitudeDeg > BLINDS.setAltitudeDeg &&
    altitudeDeg < BLINDS.belowAltitudeDeg &&
    light.cloud < BLINDS.underCloud

  return isWestLow ? Math.min(1, 1 - altitudeDeg / BLINDS.belowAltitudeDeg) : 0
}

/** The lightning flash's strength at `now` (`performance.now()`), 0 to its full alpha. */
export function flashOf(weather: WeatherFxView, now: number): number {
  const k = 1 - (now - weather.flashAt) / FLASH.ms

  return k > 0 && k <= 1 ? k * FLASH.alpha : 0
}

/** A soft haze lies over the windows on a foggy morning. */
export function isHazeOn(light: LightView, weather: WeatherFxView): boolean {
  return weather.fog && isMorningSun(light.sun) && light.sun.altitudeDeg < HAZE.untilAltitudeDeg
}

/** Something on the glass moves: the rain running down it while the glass is within `visible`,
 *  or a flash fading. */
export function isGlassMoving(weather: WeatherFxView, now: number, visible: Rect): boolean {
  const isGlassShown = visible.y < NORTH_GLASS.y + NORTH_GLASS.h

  return (weather.falling > 0 && isGlassShown) || flashOf(weather, now) > 0
}

/** The runs of the west glass the blinds hang along, either side of its doorway: from and to. */
export function blindSpansOf(floor: FloorId): readonly (readonly [number, number])[] {
  return BLIND_SPANS[floor]
}

/** Rain running down the glass over `pane` (its own px), by intensity; `t` the time in ms, held
 *  still under reduced motion. */
export function paintGlassRain(
  g: CanvasRenderingContext2D,
  pane: Rect,
  at: { readonly rain: number; readonly t: number }
): void {
  const count = Math.min(MAX_STREAKS, Math.round(pane.w * STREAKS_PER_PX * at.rain))

  if (count === 0) {
    return
  }

  g.strokeStyle = `rgba(${STREAK_RGB},${0.3 + 0.35 * at.rain})`
  g.lineWidth = STREAK.width
  g.lineCap = 'round'
  g.beginPath()

  for (let index = 0; index < count; index++) {
    const streak = index * 4
    const x = pane.x + (STREAKS[streak] ?? 0) * pane.w
    const speed = STREAK.speedPx + (STREAKS[streak + 1] ?? 0) * STREAK.speedSpan
    const length = STREAK.length + (STREAKS[streak + 2] ?? 0) * STREAK.lengthSpan * at.rain
    const fall = ((STREAKS[streak + 3] ?? 0) * pane.h + (at.t / 1000) * speed) % (pane.h + length)
    const y = pane.y + fall - length

    g.moveTo(x, Math.max(pane.y, y))
    g.lineTo(x, Math.min(pane.y + pane.h, y + length))
  }

  g.stroke()
}

export function paintGlassHaze(g: CanvasRenderingContext2D, pane: Rect): void {
  g.fillStyle = `rgba(${HAZE.rgb},${HAZE.alpha})`
  g.fillRect(pane.x, pane.y, pane.w, pane.h)
}

function buildStreaks(): Float32Array {
  const rng = createRng(seedOf('glass-rain'))
  const out = new Float32Array(MAX_STREAKS * 4)

  for (let index = 0; index < out.length; index++) {
    out[index] = rng.next()
  }

  return out
}

function westSpansOf(floor: FloorId): readonly (readonly [number, number])[] {
  const door = DOORS[floor].find((each) => each.isWest === true)
  const gapFrom = door?.at.y ?? WORLD.h
  const gapTo = door === undefined ? WORLD.h : door.at.y + door.width
  const spans: (readonly [number, number])[] = [
    [WALL_BAND_PX, gapFrom],
    [gapTo, WORLD.h],
  ]

  return spans.filter(([from, to]) => to > from)
}
