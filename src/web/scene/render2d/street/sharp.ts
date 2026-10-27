import type { Rect } from '@/web/scene/types'
import { zeroCanvas } from '@/web/scene/renderer'
import { MAX_ZOOM_3D_PX, movingRectOf, STREET_RECT } from '@/web/scene/view'

// The static canvas stretched past this many times its px reads blurry: the sharp copy takes over.
const SHARP_FROM = 1.25
const MAX_SHARP_CANVAS_PX = 4096
const NO_RECT: Rect = Object.freeze({ x: 0, y: 0, w: 0, h: 0 })
// 3D uploads the copy as a texture: its px steps up through these bands, so a zoom glide repaints
// and uploads it once a band, not every frame.
const BANDS_3D = [2.5, 3.5, 5, 6.5, MAX_ZOOM_3D_PX] as const

/** The static paint again over the visible rect and a margin, at the device's px, for a 2D zoom
 *  closer than the static canvas holds sharp: the signs and the board's lettering stay crisp. */
export interface SharpLayer {
  readonly canvas: HTMLCanvasElement
  rect: Rect
  key: string
  /** Moves with each repaint or release, so 3D uploads only a changed copy. */
  version: number
}

/** What the sharp copy is painted for: the camera, the zoom and the static paint it copies. */
interface SharpJob {
  readonly visible: Rect
  readonly devicePx: number
  readonly staticPx: number
  readonly staticVersion: number
}

export function createSharpLayer(): SharpLayer {
  return { canvas: document.createElement('canvas'), rect: NO_RECT, key: '', version: 0 }
}

/** Repaints the copy with `paint` (in world px) when the static paint or the zoom changed or the
 *  camera left its rect; a pan within the margin or a frame with nothing new repaints nothing. */
export function syncSharp(
  layer: SharpLayer,
  job: SharpJob,
  paint: (g: CanvasRenderingContext2D) => void
): void {
  if (!isWanted(job)) {
    releaseSharp(layer)
    return
  }

  const g = layer.canvas.getContext('2d')

  if (isSharpCurrent(layer, job) || g === null) {
    return
  }

  const rect = movingRectOf(job.visible)
  const px = Math.min(job.devicePx, MAX_SHARP_CANVAS_PX / Math.max(rect.w, rect.h))
  const width = Math.max(1, Math.ceil(rect.w * px))
  const height = Math.max(1, Math.ceil(rect.h * px))

  if (layer.canvas.width !== width || layer.canvas.height !== height) {
    layer.canvas.width = width
    layer.canvas.height = height
  }

  g.setTransform(1, 0, 0, 1, 0, 0)
  g.clearRect(0, 0, width, height)
  g.setTransform(px, 0, 0, px, -rect.x * px, -rect.y * px)
  paint(g)
  layer.rect = rect
  layer.key = keyOf(job)
  layer.version++
}

/** The copy still fits the camera: it is not needed, or painted for this zoom and static paint
 *  over a rect holding the visible street. */
export function isSharpCurrent(layer: SharpLayer, job: SharpJob): boolean {
  if (!isWanted(job)) {
    return layer.canvas.width === 0
  }

  return layer.key === keyOf(job) && holds(layer.rect, job.visible)
}

export function releaseSharp(layer: SharpLayer): void {
  if (layer.canvas.width === 0) {
    return
  }

  zeroCanvas(layer.canvas)
  layer.rect = NO_RECT
  layer.key = ''
  layer.version++
}

/** The px 3D paints the copy at for `devicePx`: the band at or over it, or 0 while the static
 *  canvas is sharp enough. */
export function sharpPx3d(devicePx: number, staticPx: number): number {
  if (devicePx < staticPx * SHARP_FROM) {
    return 0
  }

  return BANDS_3D.find((band) => band >= devicePx) ?? devicePx
}

function isWanted(job: SharpJob): boolean {
  return job.devicePx >= job.staticPx * SHARP_FROM
}

function keyOf(job: SharpJob): string {
  return `${job.staticVersion}|${job.devicePx}`
}

// Whether `rect` holds the part of `visible` the street covers.
function holds(rect: Rect, visible: Rect): boolean {
  const x0 = Math.max(STREET_RECT.x, visible.x)
  const y0 = Math.max(STREET_RECT.y, visible.y)
  const x1 = Math.min(STREET_RECT.x + STREET_RECT.w, visible.x + visible.w)
  const y1 = Math.min(STREET_RECT.y + STREET_RECT.h, visible.y + visible.h)

  return x0 >= rect.x && y0 >= rect.y && x1 <= rect.x + rect.w && y1 <= rect.y + rect.h
}
