import type { RendererStats, SceneRenderer } from '@/web/scene/renderer'
import { type Point, type ScreenPoint, WORLD } from '@/web/scene/types'

const CANVAS_CLASS = 'scene-canvas'
const FLOOR_FILL_TOKEN = '--stageHi'
const FLOOR_EDGE_TOKEN = '--border'
const FLOOR_EDGE_PX = 1
const RENDER_WINDOW_MS = 1_000
// Above any display's refresh rate, so the window never drops a render it should count.
const MAX_RENDER_SAMPLES = 240
const IDENTITY_FIT: Fit = Object.freeze({ scale: 1, offsetX: 0, offsetY: 0 })

/** World-to-screen: CSS pixels per world pixel, and where the floor's corner sits. */
interface Fit {
  readonly scale: number
  readonly offsetX: number
  readonly offsetY: number
}

// One mounted canvas and the fit of its last draw.
interface Surface {
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  scale: number
  offsetX: number
  offsetY: number
}

/** The 2D renderer: a canvas filling its host, the floor fitted and centred in it. */
export function createRenderer2d(): SceneRenderer {
  let surface: Surface | undefined
  let frameMs = 0
  const renderTimes: number[] = []

  return {
    mount(host) {
      surface ??= createSurface(host)
    },
    unmount() {
      surface?.canvas.remove()
      surface = undefined
    },
    draw(_view, now) {
      if (surface === undefined) {
        return false
      }

      const startedAt = performance.now()

      drawFloor(surface)
      frameMs = performance.now() - startedAt
      recordRender(renderTimes, now)

      return false
    },
    toScreen: (p) => toScreen(surface, p),
    toWorld: (s) => toWorld(surface, s),
    stats: (): RendererStats => ({
      frameMs,
      rendersPerSecond: countRecent(renderTimes, performance.now()),
    }),
  }
}

function createSurface(host: HTMLElement): Surface | undefined {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (context === null) {
    return undefined
  }

  canvas.className = CANVAS_CLASS
  host.append(canvas)

  return { canvas, context, scale: 1, offsetX: 0, offsetY: 0 }
}

function drawFloor(surface: Surface): void {
  const { canvas, context } = surface
  const ratio = devicePixelRatio
  const width = canvas.clientWidth
  const height = canvas.clientHeight

  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
  }

  surface.scale = Math.min(width / WORLD.w, height / WORLD.h)
  surface.offsetX = (width - WORLD.w * surface.scale) / 2
  surface.offsetY = (height - WORLD.h * surface.scale) / 2

  const tokens = getComputedStyle(canvas)

  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  context.fillStyle = tokens.getPropertyValue(FLOOR_FILL_TOKEN)
  context.strokeStyle = tokens.getPropertyValue(FLOOR_EDGE_TOKEN)
  context.lineWidth = FLOOR_EDGE_PX
  context.fillRect(
    surface.offsetX,
    surface.offsetY,
    WORLD.w * surface.scale,
    WORLD.h * surface.scale
  )
  context.strokeRect(
    surface.offsetX,
    surface.offsetY,
    WORLD.w * surface.scale,
    WORLD.h * surface.scale
  )
}

function toScreen(surface: Surface | undefined, p: Point): ScreenPoint {
  const fit = fitOf(surface)

  return { x: fit.offsetX + p.x * fit.scale, y: fit.offsetY + p.y * fit.scale }
}

function toWorld(surface: Surface | undefined, s: ScreenPoint): Point {
  const fit = fitOf(surface)

  return { x: (s.x - fit.offsetX) / fit.scale, y: (s.y - fit.offsetY) / fit.scale }
}

// An unmounted or zero-sized canvas maps one to one, so neither direction divides by zero.
function fitOf(surface: Surface | undefined): Fit {
  return surface === undefined || surface.scale <= 0 ? IDENTITY_FIT : surface
}

function recordRender(renderTimes: number[], now: number): void {
  renderTimes.push(now)

  if (renderTimes.length > MAX_RENDER_SAMPLES) {
    renderTimes.shift()
  }
}

function countRecent(renderTimes: readonly number[], now: number): number {
  return renderTimes.filter((at) => now - at < RENDER_WINDOW_MS).length
}
