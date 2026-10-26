import type { WeatherFxView } from '@/web/scene/sky-types'
import type { FloorId, LightView } from '@/web/scene/types'
import { type WindowLight, windowLightOf } from '@/web/scene/clock/window-light'
import {
  blindSpansOf,
  flashOf,
  isHazeOn,
  NORTH_GLASS,
  paintGlassHaze,
  paintGlassRain,
} from '@/web/scene/sprites/sky-glass'
import { WORLD } from '@/web/scene/types'
import { WALL_BAND_PX } from '@/web/scene/world/rooms'

// The mockup's window light: a warm patch inside each sunlit glass side, added in 'lighter' blend,
// reaching the depth the sun's height casts (the north and south a little shallower); and slatted
// blinds two px wide down the west and east glass, the west's broken by its doorway.
const PATCH = Object.freeze({ rgb: '255,214,140', alpha: 0.34, edgePx: 3, endShare: 0.6 })
const PATCH_MIN = 0.01
const BLIND = Object.freeze({
  w: 2,
  westX: 3,
  eastX: WORLD.w - 5,
  bottom: WORLD.h - 3,
  slatPx: 3,
  tone: '#EBE5D5',
  slat: '#B9B2A0',
  least: 0.03,
  alphaK: 1.2,
})

interface SkyFxJob {
  readonly floor: FloorId
  readonly light: LightView
  readonly weather: WeatherFxView
  readonly now: number
}

/** The sky inside: the sun's patches, the west and east blinds, rain and haze on the north glass, and a
 *  lightning flash over the floor. */
export function paintSkyFx(g: CanvasRenderingContext2D, job: SkyFxJob): void {
  const { light, weather } = job

  const window = windowLightOf(light.sun, { cloud: light.cloud, rain: weather.rain })

  paintSunPatches(g, window)
  paintBlinds(g, { floor: job.floor, window })

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

function paintSunPatches(g: CanvasRenderingContext2D, window: WindowLight): void {
  const { patch: p, depth: d } = window
  const top = WALL_BAND_PX
  const roomH = WORLD.h - top - PATCH.edgePx
  const far = WORLD.w - PATCH.edgePx
  const bottom = WORLD.h - PATCH.edgePx

  g.globalCompositeOperation = 'lighter'
  sunPatch(g, { from: [PATCH.edgePx, 0], to: [PATCH.edgePx + d.w, 0], strength: p.w }, [
    PATCH.edgePx,
    top,
    d.w,
    roomH,
  ])
  sunPatch(g, { from: [far, 0], to: [far - d.e, 0], strength: p.e }, [far - d.e, top, d.e, roomH])
  sunPatch(g, { from: [0, top], to: [0, top + d.n * PATCH.endShare], strength: p.n }, [
    0,
    top,
    WORLD.w,
    d.n * PATCH.endShare,
  ])
  sunPatch(g, { from: [0, bottom], to: [0, bottom - d.s * PATCH.endShare], strength: p.s }, [
    0,
    bottom - d.s * PATCH.endShare,
    WORLD.w,
    d.s * PATCH.endShare,
  ])
  g.globalCompositeOperation = 'source-over'
}

function sunPatch(
  g: CanvasRenderingContext2D,
  line: {
    readonly from: readonly [number, number]
    readonly to: readonly [number, number]
    readonly strength: number
  },
  box: readonly [number, number, number, number]
): void {
  if (line.strength <= PATCH_MIN) {
    return
  }

  const gradient = g.createLinearGradient(line.from[0], line.from[1], line.to[0], line.to[1])

  gradient.addColorStop(0, `rgba(${PATCH.rgb},${(PATCH.alpha * line.strength).toFixed(3)})`)
  gradient.addColorStop(1, `rgba(${PATCH.rgb},0)`)
  g.fillStyle = gradient
  g.fillRect(box[0], box[1], box[2], box[3])
}

// Slatted blinds down the west and east glass, as far as each is drawn; the west's skip its door.
function paintBlinds(
  g: CanvasRenderingContext2D,
  at: { readonly floor: FloorId; readonly window: WindowLight }
): void {
  const sides = [
    { x: BLIND.westX, closure: at.window.blind.w, spans: blindSpansOf(at.floor) },
    { x: BLIND.eastX, closure: at.window.blind.e, spans: [[WALL_BAND_PX, BLIND.bottom]] as const },
  ]

  for (const side of sides) {
    if (side.closure < BLIND.least) {
      continue
    }

    g.globalAlpha = Math.min(1, side.closure * BLIND.alphaK)

    for (const [from, to] of side.spans) {
      paintSlats(g, { x: side.x, from, to: Math.min(to, BLIND.bottom) })
    }
  }

  g.globalAlpha = 1
}

// Two px of cloth then a px of slat edge, repeated down the glass.
function paintSlats(
  g: CanvasRenderingContext2D,
  at: { readonly x: number; readonly from: number; readonly to: number }
): void {
  g.fillStyle = BLIND.tone
  g.fillRect(at.x, at.from, BLIND.w, at.to - at.from)
  g.fillStyle = BLIND.slat

  for (let y = at.from + BLIND.slatPx - 1; y < at.to; y += BLIND.slatPx) {
    g.fillRect(at.x, y, BLIND.w, 1)
  }
}
