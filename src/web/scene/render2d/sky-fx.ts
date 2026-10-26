import type { WeatherFxView } from '@/web/scene/sky-types'
import type { FloorId, LightView } from '@/web/scene/types'
import {
  blindClosureOf,
  flashOf,
  isHazeOn,
  NORTH_GLASS,
  paintGlassHaze,
  paintGlassRain,
} from '@/web/scene/sprites/sky-glass'
import { WORLD } from '@/web/scene/types'
import { DOORS } from '@/web/scene/world/doors'
import { WALL_BAND_PX } from '@/web/scene/world/rooms'

const DEG = Math.PI / 180
// The sun through the glass: a warm patch on the floor beside the wall it falls through, longer
// the lower the sun, fading in over its first degrees and under cloud.
const PATCH = Object.freeze({
  rgb: '255,214,150',
  alpha: 0.16,
  riseDeg: 8,
  depthK: 22,
  minDepth: 12,
  maxDepth: 96,
})
const BLIND = Object.freeze({ w: 5, slatPx: 2, tone: '#EDE3CC', slat: '#CDBF9F' })

interface SkyFxJob {
  readonly floor: FloorId
  readonly light: LightView
  readonly weather: WeatherFxView
  readonly now: number
}

/** The sky inside: the sun's patches, the west blinds, rain and haze on the north glass, and a
 *  lightning flash over the floor. */
export function paintSkyFx(g: CanvasRenderingContext2D, job: SkyFxJob): void {
  const { light, weather } = job

  paintSunPatches(g, light)
  paintBlinds(g, { floor: job.floor, closure: blindClosureOf(light) })

  if (weather.rain > 0) {
    paintGlassRain(g, NORTH_GLASS, {
      rain: weather.rain,
      t: weather.falling > 0 ? job.now : 0,
    })
  }

  if (isHazeOn(light, weather)) {
    paintGlassHaze(g, NORTH_GLASS)
  }

  const flash = flashOf(weather, job.now)

  if (flash > 0) {
    g.fillStyle = `rgba(255,255,255,${flash})`
    g.fillRect(0, 0, WORLD.w, WORLD.h)
  }
}

function paintSunPatches(g: CanvasRenderingContext2D, light: LightView): void {
  const { altitudeDeg, azimuthDeg } = light.sun

  if (altitudeDeg <= 0) {
    return
  }

  const strength = PATCH.alpha * (1 - light.cloud) * Math.min(1, altitudeDeg / PATCH.riseDeg)
  const depth = Math.min(
    PATCH.maxDepth,
    Math.max(PATCH.minDepth, PATCH.depthK / Math.tan(altitudeDeg * DEG))
  )
  const east = Math.sin(azimuthDeg * DEG)
  const north = Math.cos(azimuthDeg * DEG)
  const top = WALL_BAND_PX
  const roomH = WORLD.h - top
  // Through the east or the west glass, and through the north or the south.
  const side =
    east > 0
      ? { x0: WORLD.w, x1: WORLD.w - depth, box: [WORLD.w - depth, top, depth, roomH] as const }
      : { x0: 0, x1: depth, box: [0, top, depth, roomH] as const }
  const end =
    north > 0
      ? { y0: top, y1: top + depth, box: [0, top, WORLD.w, depth] as const }
      : { y0: WORLD.h, y1: WORLD.h - depth, box: [0, WORLD.h - depth, WORLD.w, depth] as const }

  patch(
    g,
    { x0: side.x0, y0: top, x1: side.x1, y1: top, alpha: strength * Math.abs(east) },
    side.box
  )
  patch(g, { x0: 0, y0: end.y0, x1: 0, y1: end.y1, alpha: strength * Math.abs(north) }, end.box)
}

function patch(
  g: CanvasRenderingContext2D,
  line: {
    readonly x0: number
    readonly y0: number
    readonly x1: number
    readonly y1: number
    readonly alpha: number
  },
  box: readonly [number, number, number, number]
): void {
  if (line.alpha <= 0) {
    return
  }

  const gradient = g.createLinearGradient(line.x0, line.y0, line.x1, line.y1)

  gradient.addColorStop(0, `rgba(${PATCH.rgb},${line.alpha})`)
  gradient.addColorStop(1, `rgba(${PATCH.rgb},0)`)
  g.fillStyle = gradient
  g.fillRect(box[0], box[1], box[2], box[3])
}

// Slatted blinds down the west glass, either side of its doorway, as far as they are drawn.
function paintBlinds(
  g: CanvasRenderingContext2D,
  at: { readonly floor: FloorId; readonly closure: number }
): void {
  if (at.closure <= 0) {
    return
  }

  const door = DOORS[at.floor].find((each) => each.isWest === true)
  const gapFrom = door?.at.y ?? WORLD.h
  const gapTo = door === undefined ? WORLD.h : door.at.y + door.width

  g.globalAlpha = at.closure

  for (const [from, to] of [
    [WALL_BAND_PX, gapFrom],
    [gapTo, WORLD.h],
  ] as const) {
    g.fillStyle = BLIND.tone
    g.fillRect(0, from, BLIND.w, to - from)
    g.fillStyle = BLIND.slat

    for (let y = from; y < to; y += BLIND.slatPx * 2) {
      g.fillRect(0, y, BLIND.w, BLIND.slatPx / 2)
    }
  }

  g.globalAlpha = 1
}
